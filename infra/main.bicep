targetScope = 'resourceGroup'

@description('Workshop team identifier used for resource naming and tagging.')
@minLength(2)
@maxLength(32)
param teamIdentifier string

@description('Azure region for all resources.')
param location string = resourceGroup().location

@description('App Service plan SKU. B1 keeps the workshop inexpensive while supporting Always On.')
param appServicePlanSku string = 'B1'

@description('Azure Table Storage table used by the feedback application.')
@minLength(3)
@maxLength(63)
param feedbackTableName string = 'Feedback'

@description('Explicit IPv4 or IPv6 CIDR ranges allowed to access the workshop app.')
@minLength(1)
@maxLength(100)
param workshopAllowedCidrs array

@description('Additional tags applied to every resource.')
param tags object = {}

var uniqueSuffix = uniqueString(resourceGroup().id, teamIdentifier)
var storageAccountName = 'st${uniqueSuffix}'
var logAnalyticsName = 'log-workshop-${uniqueSuffix}'
var applicationInsightsName = 'appi-workshop-${uniqueSuffix}'
var appServicePlanName = 'plan-workshop-${uniqueSuffix}'
var webAppName = 'app-workshop-${uniqueSuffix}'
var commonTags = union(tags, {
  workload: 'agentic-sdlc-workshop'
  team: teamIdentifier
  managedBy: 'bicep'
})

module storage 'br/public:avm/res/storage/storage-account:0.33.1' = {
  name: 'storage'
  params: {
    name: storageAccountName
    location: location
    skuName: 'Standard_LRS'
    kind: 'StorageV2'
    allowBlobPublicAccess: false
    allowCrossTenantReplication: false
    allowSharedKeyAccess: false
    defaultToOAuthAuthentication: true
    minimumTlsVersion: 'TLS1_2'
    publicNetworkAccess: 'Enabled'
    supportsHttpsTrafficOnly: true
    tableServices: {
      tables: [
        {
          name: feedbackTableName
        }
      ]
    }
    tags: commonTags
  }
}

module logAnalytics 'br/public:avm/res/operational-insights/workspace:0.16.1' = {
  name: 'log-analytics'
  params: {
    name: logAnalyticsName
    location: location
    skuName: 'PerGB2018'
    dataRetention: 30
    dailyQuotaGb: '1'
    features: {
      disableLocalAuth: true
      enableLogAccessUsingOnlyResourcePermissions: true
    }
    tags: commonTags
  }
}

module applicationInsights 'br/public:avm/res/insights/component:0.8.0' = {
  name: 'application-insights'
  params: {
    name: applicationInsightsName
    location: location
    applicationType: 'web'
    workspaceResourceId: logAnalytics.outputs.resourceId
    retentionInDays: 30
    tags: commonTags
  }
}

module appServicePlan 'br/public:avm/res/web/serverfarm:0.7.0' = {
  name: 'app-service-plan'
  params: {
    name: appServicePlanName
    location: location
    kind: 'linux'
    reserved: true
    skuName: appServicePlanSku
    skuCapacity: 1
    zoneRedundant: false
    tags: commonTags
  }
}

module webApp 'br/public:avm/res/web/site:0.24.0' = {
  name: 'web-app'
  params: {
    name: webAppName
    location: location
    kind: 'app,linux'
    serverFarmResourceId: appServicePlan.outputs.resourceId
    httpsOnly: true
    clientAffinityEnabled: false
    managedIdentities: {
      systemAssigned: true
    }
    publicNetworkAccess: 'Enabled'
    siteConfig: {
      alwaysOn: true
      ftpsState: 'Disabled'
      http20Enabled: true
      linuxFxVersion: 'NODE|22-lts'
      minTlsVersion: '1.2'
      scmMinTlsVersion: '1.2'
      use32BitWorkerProcess: false
      webSocketsEnabled: false
      ipSecurityRestrictions: [for (cidr, index) in workshopAllowedCidrs: {
        name: 'workshop-${index + 1}'
        ipAddress: cidr
        action: 'Allow'
        priority: 100 + index
        description: 'Instructor-approved workshop network'
      }]
      ipSecurityRestrictionsDefaultAction: 'Deny'
    }
    configs: [
      {
        name: 'appsettings'
        applicationInsightResourceId: applicationInsights.outputs.resourceId
        retainCurrentAppSettings: false
        properties: {
          NODE_ENV: 'production'
          PORT: '8080'
          WEBSITE_NODE_DEFAULT_VERSION: '~22'
          SCM_DO_BUILD_DURING_DEPLOYMENT: 'true'
          ENABLE_ORYX_BUILD: 'true'
          STORAGE_BACKEND: 'azure'
          AZURE_STORAGE_ACCOUNT_URL: 'https://${storage.outputs.name}.table.${environment().suffixes.storage}'
          AZURE_STORAGE_TABLE_NAME: feedbackTableName
        }
      }
    ]
    basicPublishingCredentialsPolicies: [
      {
        name: 'ftp'
        allow: false
      }
      {
        name: 'scm'
        allow: false
      }
    ]
    diagnosticSettings: [
      {
        name: 'send-to-log-analytics'
        workspaceResourceId: logAnalytics.outputs.resourceId
      }
    ]
    tags: commonTags
  }
}

resource storageAccount 'Microsoft.Storage/storageAccounts@2025-06-01' existing = {
  name: storageAccountName
}

var storageTableDataContributorRoleDefinitionId = subscriptionResourceId(
  'Microsoft.Authorization/roleDefinitions',
  '0a9a7e1f-b9d0-4cc4-a60d-0319b160aaa3'
)

resource storageTableDataContributor 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(storageAccount.id, webAppName, storageTableDataContributorRoleDefinitionId)
  scope: storageAccount
  properties: {
    roleDefinitionId: storageTableDataContributorRoleDefinitionId
    principalId: webApp.outputs.systemAssignedMIPrincipalId!
    principalType: 'ServicePrincipal'
    description: 'Allows the workshop web app to read and write feedback in Azure Table Storage.'
  }
}

@description('Name of the deployed App Service web app.')
output appName string = webApp.outputs.name

@description('HTTPS URL of the deployed workshop application.')
output appUrl string = 'https://${webApp.outputs.defaultHostname}'

@description('Resource ID of the deployed web app.')
output appResourceId string = webApp.outputs.resourceId

@description('Deployment identifier used for evidence collection.')
output deploymentIdentifier string = deployment().name

@description('Monitoring resources associated with the application.')
output monitoring object = {
  applicationInsightsName: applicationInsights.outputs.name
  applicationInsightsResourceId: applicationInsights.outputs.resourceId
  logAnalyticsWorkspaceName: logAnalytics.outputs.name
  logAnalyticsWorkspaceResourceId: logAnalytics.outputs.resourceId
}

@description('Storage details required by the application.')
output storage object = {
  accountName: storage.outputs.name
  tableName: feedbackTableName
}
