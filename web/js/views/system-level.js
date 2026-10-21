// The system map's level (0.28.1), pure: which level the URL asks for, whether the control shows, and the words on it.
// `level=subsystems` lives in the URL; the default stays the component level, and a link to the subsystem level in an environment without subsystems falls back to it.

/** The level to draw: 'subsystems' only when asked for and the environment has subsystems. */
export const levelOf = (param, hasSubsystems) => (hasSubsystems && param === 'subsystems' ? 'subsystems' : 'components');

/** The query value of a level: absent for the default. */
export const levelParam = (level) => (level === 'subsystems' ? 'subsystems' : null);

/** Does the Subsystem | Component control show? Only when the environment has at least one subsystem (a design, or a sealed one with groupPaths). */
export const showLevelControl = (subsystems) => !!subsystems?.has;

const plural = (w) => (/s$/i.test(w) ? w : `${w}s`);

/** The words on the control from the environment's level names (outermost first): the first is the subsystem level, the last the component level; Domains waits for later. */
export function levelLabels(levels = []) {
  const first = levels[0] || 'Subsystem', last = levels.length > 1 ? levels[levels.length - 1] : 'Component';
  return { subsystems: plural(first), components: plural(last), domains: levels.length > 2 ? plural(levels[1]) : 'Domains' };
}
