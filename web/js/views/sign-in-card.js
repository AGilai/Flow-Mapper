// Frame 27a: signed out, the app shows one card with a single Sign in button that goes to the Cognito hosted page.
// Shown by main.js when GET /api/me says nobody is signed in, and again when any call answers 401 (the session ended).

import { h, fill } from '../dom.js';
import { brandMark } from '../icons.js';

export function showSignIn(main, rail) {
  document.getElementById('app')?.classList.add('signed-out');
  if (rail) fill(rail);
  const back = encodeURIComponent(`/${location.hash}`);
  fill(main, h('div.ac-land', { 'data-qa': 'sign-in-card' },
    h('div.ac-card',
      h('div.ac-lb', brandMark(), h('b', 'Flow-Mapper')),
      h('h2', 'Design how your services talk to each other'),
      h('p', 'Map flows from harvested systems, then sketch high-level and low-level designs next to them. Your designs stay private until you share them.'),
      h('a.btn.primary.ac-big', { href: `/auth/login?returnTo=${back}`, 'data-qa': 'sign-in' }, 'Sign in'),
      h('p.ac-fine', 'You will go to your company sign-in page (Amazon Cognito) and come back here. Agents sign in with a personal access token instead. See Tokens after you sign in.'))));
}
