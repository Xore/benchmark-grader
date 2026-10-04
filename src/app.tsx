// Bootstrap. The dashboard itself lives in ./dashboard.tsx (adapted from the
// official `astryx template ide` scaffold). serve.ts builds this path, so the
// entry stays here and holds only the theme + first-paint bootstrap.

import {createRoot} from 'react-dom/client';

import {Theme} from '@astryxdesign/core/theme';

// The project's own editable copy of the neutral theme, not the shipped
// build. It is currently byte-identical to
// `@astryxdesign/theme-neutral/dist/theme.css` (verified by building it with
// `astryx theme build` and diffing), and it now carries this app's two
// component overrides — the Selector focus ring and the TreeList chevron hit
// target — which the shipped build cannot hold. An unbuilt theme injects its
// CSS at runtime; once this file is on the hot path for real, run
// `astryx theme build src/themes/neutral/neutralTheme.ts --out
// src/themes/neutral/neutral.css` and import the built output instead.
import {neutralTheme} from './themes/neutral/neutralTheme';

import Dashboard from './dashboard';

import {ready as shikiReady} from './shiki-tokenizer';

// Wait for the Shiki highlighter before the first paint: CodeBlock's tokenizer
// is synchronous, so no block may render before tokens can exist.
if (typeof document !== 'undefined') {
  const root = document.getElementById('root')
  if (root)
    void shikiReady().then(() =>
      createRoot(root).render(
        <Theme theme={neutralTheme}>
          <Dashboard />
        </Theme>,
      ),
    )
}