// The glue between a flow's document and its diagram (Unreleased, frame 28f). The Notes view tells it the body (`onBody`) and which callout card the pointer is on
// (`onHover`); it gives the step walk the badges to draw (core/callouts.ts) and the outline of the hovered step. `open(step)` is what a press on a badge does
// (the pane shows the document and scrolls to the callout). It works whether or not the pane is on the page: the badges come from the document.

import { callouts, badges } from '../../core/callouts.js';

/** createFlowDocLink({ walk, open(step) }) -> { onBody(html | null), onHover(step | null, kind), steps() } */
export function createFlowDocLink({ walk, open }) {
  let list = [];
  return {
    onBody: (html) => { list = html ? callouts(html) : []; walk.setBadges(badges(list, walk.steps().length), open); },
    onHover: (step, kind) => { if (step == null) walk.hoverStep(null); else walk.hoverStep(step, kind ?? badges(list, 0).find((b) => b.step === step)?.kind ?? 'watch'); },
    steps: () => list,
  };
}
