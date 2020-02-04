# docs-utils

> Utilities for parsing and validating JSDoc

**Note:** Requires Node 10.10+.  Not designed to run on Windows.

## Standalone Usage

Can be used standalone to validate inline documentation.  Add as a dev dependency and create an npm task:

```sh
npm install --save-dev @enact/docs-utils
```

```json
  "validate-docs": "validate-docs --strict --standalone"
```

### Options

`--standalone` - Operate in standalone mode

`--strict` - Set exit code when warnings are discovered

`--path` - Path to scan for modules. Defaults to current directory
