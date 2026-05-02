# Betty CLI – Copilot Coding Instructions

## Code Style

- **No curly braces for single-line `if` statements.**
  ```ts
  // ✅
  if (!value) return;
  if (err) throw new Error('...');

  // ❌
  if (!value) {
    return;
  }
  ```

- Arrow functions preferred over `function` declarations.
- Export at end of file (`export default ...`).
- `T[]` instead of `Array<T>`.
- `??` instead of `||` for nullable coalescing.
- `=== true` / `!== null` instead of truthy checks for booleans and nullable strings.
- `${String(num)}` for numbers in template literals.
