import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'

// Flat config (ESLint 9). Scope is the app source; generated/vendored UI
// primitives under src/components/ui and build output are ignored. Rules lean
// pragmatic — correctness-focused rules stay errors, stylistic noise is off —
// so the gate catches real problems without drowning the team in churn.
export default tseslint.config(
  {
    ignores: [
      'dist',
      'build',
      'node_modules',
      'backend/**', // Python backend + its .venv (bundled vendor JS); not our source
      '**/.venv/**',
      'src/app/components/ui/**', // generated shadcn/ui primitives
      'src/imports/**',
      'src/assets/**',
      '**/*.config.{js,ts,mjs}',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      globals: { ...globals.browser, ...globals.es2022 },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-empty-object-type': 'off',
    },
  },
  {
    files: ['src/**/*.{test,spec}.{ts,tsx}', 'src/test/**'],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
)
