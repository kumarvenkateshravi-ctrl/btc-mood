/**
 * Playwright CT hooks — runs in the browser iframe before each mount.
 * Imports the MDS global stylesheet so Tailwind classes + CSS-variable
 * themes are active during component tests.
 *
 * NOTE: the default export must be a plain serializable object (no functions)
 * because Playwright CT serializes hooksConfig to match the registered hooks.
 */
import '../../app/globals.css';

export default {};
