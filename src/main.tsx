import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './ui/styles/global.css';
import { App } from './app/App';
import { Editor } from './engine/Editor';
import { WebGLUnavailableError } from './engine/gl/context';
import { EditorContext } from './ui/editorContext';
import { UnsupportedBrowser } from './ui/UnsupportedBrowser';

const root = createRoot(document.getElementById('root')!);

let editor: Editor | null = null;
let startupError: string | null = null;
try {
  editor = new Editor();
} catch (err) {
  startupError =
    err instanceof WebGLUnavailableError ? err.message : `The editor failed to start: ${String(err)}`;
  console.error(err);
}

if (editor) {
  // Scripting/debug handle for automated tests and power users.
  (window as unknown as { __emulsion?: Editor }).__emulsion = editor;
  root.render(
    <StrictMode>
      <EditorContext.Provider value={editor}>
        <App />
      </EditorContext.Provider>
    </StrictMode>,
  );
} else {
  root.render(<UnsupportedBrowser message={startupError ?? 'Unknown error'} />);
}
