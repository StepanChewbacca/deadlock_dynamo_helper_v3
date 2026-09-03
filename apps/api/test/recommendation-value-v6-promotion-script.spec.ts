import fs from 'node:fs';
import path from 'node:path';

describe('Recommendation Value V6 promotion script', () => {
  it('accepts an existing immutable target before requiring the one-time source artifact', () => {
    const scriptPath = path.resolve(
      __dirname,
      '../../../scripts/promote-recommendation-value-v6-live.sh',
    );
    const source = fs.readFileSync(scriptPath, 'utf8');
    const targetValidation = source.indexOf('if sudo test -e "$TARGET_DIR"; then');
    const sourceValidation = source.indexOf('for file_name in model.json manifest.json audit.json evaluation.json; do');

    expect(targetValidation).toBeGreaterThanOrEqual(0);
    expect(sourceValidation).toBeGreaterThanOrEqual(0);
    expect(targetValidation).toBeLessThan(sourceValidation);
  });

  it('keeps main deployments on an exact revision-tagged image', () => {
    const workflowPath = path.resolve(__dirname, '../../../.github/workflows/deploy.yml');
    const workflow = fs.readFileSync(workflowPath, 'utf8');

    expect(workflow).toContain(
      'ADAPTIVE_PRODUCTION_IMAGE: deadlock-adaptive-production:${{ github.sha }}',
    );
    expect(workflow).toContain('--label "org.opencontainers.image.revision=${GITHUB_SHA}"');
    expect(workflow).toContain('DEADLOCK_API_IMAGE="$ADAPTIVE_PRODUCTION_IMAGE"');
    expect(workflow.match(/node run-migrations\.js/g)).toHaveLength(1);
    expect(workflow).toContain("DB_RUN_MIGRATIONS='false'");
    expect(workflow).not.toContain("DB_RUN_MIGRATIONS: 'true'");
  });
});
