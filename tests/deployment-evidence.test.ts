import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const workflow = readFileSync(".github/workflows/deploy.yml", "utf8");
const infrastructure = readFileSync("infra/main.bicep", "utf8");
const exampleParameters = readFileSync("infra/main.example.bicepparam", "utf8");

describe("deployment evidence workflow contract", () => {
  it("requires the selected commit to be the same-repository pull-request head", () => {
    expect(workflow).toMatch(
      /pullRequestNumber:\s*\r?\n\s+description:[^\r\n]+\r?\n\s+required: true\r?\n\s+type: number/,
    );
    expect(workflow).toContain('head.repo.full_name // empty');
    expect(workflow).toContain(
      'Selected commit $DEPLOYED_SHA is not the current head $head_sha of pull request #$PR_NUMBER.',
    );
    expect(workflow).not.toContain('pulls/$PR_NUMBER/commits');
    expect(workflow).toContain("gh pr checks \"$PR_NUMBER\" --required");
  });

  it("publishes evidence only after successful live verification", () => {
    const verifyIndex = workflow.indexOf(
      "name: Verify deployed health, readiness, and API",
    );
    const evidenceIndex = workflow.indexOf(
      "name: Create machine-readable deployment evidence",
    );
    const artifactIndex = workflow.indexOf("name: Upload deployment evidence");

    expect(verifyIndex).toBeGreaterThan(-1);
    expect(evidenceIndex).toBeGreaterThan(verifyIndex);
    expect(artifactIndex).toBeGreaterThan(evidenceIndex);
    expect(workflow).toContain("([.verification[]] | all)");
    expect(workflow).not.toMatch(
      /name: Upload deployment evidence\s*\n\s+if: always\(\)/,
    );
  });

  it("requires an explicit CIDR allowlist and denies other app ingress", () => {
    expect(infrastructure).toMatch(
      /@minLength\(1\)\s+@maxLength\(100\)\s+param workshopAllowedCidrs array/,
    );
    expect(infrastructure).toContain("ipSecurityRestrictions:");
    expect(infrastructure).toContain("ipSecurityRestrictionsDefaultAction: 'Deny'");
    expect(infrastructure).toContain("priority: 100 + index");
    expect(exampleParameters).toContain("param workshopAllowedCidrs");
    expect(exampleParameters).toContain("198.51.100.0/24");
    expect(exampleParameters).toContain("documentation range only");
  });

  it("validates workshop CIDRs before deployment and passes them into Bicep", () => {
    const inputValidationIndex = workflow.indexOf(
      "name: Validate deployment inputs and OIDC configuration",
    );
    const infrastructureIndex = workflow.indexOf("name: Deploy infrastructure");

    expect(inputValidationIndex).toBeGreaterThan(-1);
    expect(workflow.indexOf("WORKSHOP_ALLOWED_CIDRS", inputValidationIndex)).toBeLessThan(
      infrastructureIndex,
    );
    expect(workflow).toContain("Missing WORKSHOP_ALLOWED_CIDRS");
    expect(workflow).toContain('ipaddress.ip_network(value.strip(), strict=True)');
    expect(workflow).toContain(
      'workshopAllowedCidrs="$WORKSHOP_ALLOWED_CIDRS_JSON"',
    );
  });

  it("removes temporary runner access and proves outside denial before evidence", () => {
    const allowIndex = workflow.indexOf(
      "name: Temporarily allow this runner for smoke verification",
    );
    const verifyIndex = workflow.indexOf(
      "name: Verify deployed health, readiness, and API",
    );
    const cleanupIndex = workflow.indexOf(
      "name: Remove runner ingress and verify outsider denial",
    );
    const evidenceIndex = workflow.indexOf(
      "name: Create machine-readable deployment evidence",
    );

    expect(allowIndex).toBeGreaterThan(-1);
    expect(allowIndex).toBeLessThan(verifyIndex);
    expect(cleanupIndex).toBeGreaterThan(verifyIndex);
    expect(cleanupIndex).toBeLessThan(evidenceIndex);
    expect(workflow).toContain('rule_name="github-actions-${GITHUB_RUN_ID}"');
    expect(workflow).toContain("--ip-address \"${runner_ip}/32\"");
    expect(workflow).toContain("--priority 2000");
    expect(workflow).toMatch(/if: \$\{\{ always\(\) && steps\.infrastructure\.outputs\.app_name != '' \}\}/);
    expect(workflow).toContain("az webapp config access-restriction remove");
    expect(workflow).toContain("Expected HTTP 403 from outside the workshop allowlist");
    expect(workflow).toContain("runner_rule_cleanup");
    expect(workflow).toContain(".verification.runner_rule_cleanup == true");
  });

  it("keeps PR write permission in one post-success job", () => {
    expect(workflow.match(/pull-requests: write/g)).toHaveLength(1);
    expect(workflow).toMatch(
      /publish-evidence:\s*\n\s+needs: \[validate-linkage, deploy\]/,
    );
    expect(workflow).toContain("<!-- workshop-deployment-evidence -->");
    expect(workflow).toContain("gh api --method PATCH");
    expect(workflow).toContain("gh api --method POST");
  });

  it("records the required compact evidence fields", () => {
    for (const field of [
      "commit_sha",
      "pull_request_number",
      "required_checks",
      "security_checks",
      "deployment_name",
      "github_run_id",
      "environment",
      "application_url",
      "health",
      "readiness",
      "feedback_creation",
      "first_vote",
      "duplicate_vote_protection",
      "runner_rule_cleanup",
      "workflow_run_url",
    ]) {
      expect(workflow).toContain(field);
    }
  });
});
