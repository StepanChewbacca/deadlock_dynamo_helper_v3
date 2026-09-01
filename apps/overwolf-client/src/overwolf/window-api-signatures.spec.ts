describe('Overwolf window API call signatures', () => {
  it('does not call bringToFront without a callback', () => {
    const fs = require('fs');
    const path = require('path');
    const source = fs.readFileSync(path.resolve(__dirname, '..', 'index.ts'), 'utf8');
    expect(source).not.toMatch(/\.bringToFront\s*\(\s*[^,()]+\s*\)/);
  });
});
