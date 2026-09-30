using './main.bicep'

param teamIdentifier = 'team01'
param location = 'eastus2'
param appServicePlanSku = 'B1'
param feedbackTableName = 'Feedback'
// Reserved documentation range only; replace with instructor-approved workshop CIDRs.
param workshopAllowedCidrs = [
  '198.51.100.0/24'
]
param tags = {
  environment: 'workshop'
  owner: 'team01'
}
