// Bootstrap. The dashboard itself lives in ./dashboard.tsx (adapted from the
// official `astryx template ide` scaffold). serve.ts builds this path, so the
// entry stays here and holds only the theme + first-paint bootstrap.

import {createRoot} from 'react-dom/client';

import {Theme} from '@astryxdesign/core/theme';
import {neutralTheme} from '@astryxdesign/theme-neutral/built';

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