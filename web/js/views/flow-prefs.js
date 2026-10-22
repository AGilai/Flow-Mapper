// Per-viewer toggles of the Flows page, remembered in localStorage (a failure to read or write it is ignored).

// Squeeze (0.20.1): on by default, remembered per viewer; a click on a fold turns it off for that tab only (flow-tab-view.js).
export const sqStored = () => { try { return localStorage.getItem('flow-mapper.squeeze') !== '0'; } catch { return true; } };
// Group by subsystem (0.28.1, frame 12c): on by default, remembered per viewer; only offered when the environment has subsystems.
export const bandStored = () => { try { return localStorage.getItem('flow-mapper.bands') !== '0'; } catch { return true; } };
export const bandSave = (on) => { try { localStorage.setItem('flow-mapper.bands', on ? '1' : '0'); } catch { /* storage unavailable */ } };
// External | Full (0.38.0, #82): External is the default everywhere; the viewer's choice is remembered (a tab's URL `detail=full` wins for that tab).
export const detailStored = () => { try { return localStorage.getItem('flow-mapper.detail') === 'full' ? 'full' : 'external'; } catch { return 'external'; } };
export const detailSave = (d) => { try { localStorage.setItem('flow-mapper.detail', d === 'full' ? 'full' : 'external'); } catch { /* storage unavailable */ } };
export const sqSave = (on) => { try { localStorage.setItem('flow-mapper.squeeze', on ? '1' : '0'); } catch { /* storage unavailable */ } };
