describe('Overwolf window API call signatures', () => {
  it('does not call bringToFront without a callback', () => {
    const fs = require('fs');
    const path = require('path');
    const files = [
      path.resolve(__dirname, '..', 'index.ts'),
      path.resolve(__dirname, '..', 'dynamo_warning.ts'),
    ];
    for (const file of files) {
      const source = fs.readFileSync(file, 'utf8');
      expect(source).not.toMatch(/\.bringToFront\s*\(\s*[^,()]+\s*\)/);
    }
  });
});
