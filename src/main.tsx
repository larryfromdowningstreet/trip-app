import '@fontsource-variable/noto-serif-tc'; // serif for the forest palette; iPhone has no Chinese serif built in
import './styles/tokens.css';
import './styles/app.css';
import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { type Route, app } from './app/store';
import { isApple, isInstalled } from './platform/device';
import { ChangePin, NewTrip, Settings, Trips } from './screens/account';
import { Driver, Edit, Ticket } from './screens/item';
import { Bulk } from './screens/bulk';
import { Enroll } from './screens/enroll';
import { ArchivedTrip, Export, Import } from './screens/finished';
import { Conflicts, Members } from './screens/people';
import { Sync } from './screens/sync';
import { ListsTab } from './screens/lists';
import { NextStop, Overview } from './screens/plan';
import { InstallGuide, Lock, Onboarding, Wiped } from './screens/start';

/** Every screen, by route name. A new screen is one line here plus its route in store.ts. */
function Screen({ route }: { route: Route }) {
  switch (route.to) {
    case 'install': return <InstallGuide />;
    case 'onboarding': return <Onboarding />;
    case 'lock': return <Lock />;
    case 'wiped': return <Wiped />;
  }
  if (!app.session) return <Lock />;
  switch (route.to) {
    case 'trips': return <Trips />;
    case 'newTrip': return <NewTrip />;
    case 'settings': return <Settings />;
    case 'changePin': return <ChangePin />;
    case 'enroll': if (route.join || !app.trip) return <Enroll join />; break;
    case 'archived': return <ArchivedTrip id={route.id} />;
    case 'export': return <Export id={route.id} />;
    case 'import': return <Import />;
  }
  if (!app.trip) return <Trips />;
  switch (route.to) {
    case 'main': return <NextStop />;
    case 'overview': return <Overview day={route.day} />;
    case 'sync': return <Sync />;
    case 'lists': return <ListsTab />;
    case 'members': return <Members />;
    case 'conflicts': return <Conflicts />;
    case 'edit': return <Edit item={route.item} day={route.day} />;
    case 'driver': return <Driver item={route.item} />;
    case 'ticket': return <Ticket item={route.item} />;
    case 'enroll': return <Enroll />;
    case 'bulk': return <Bulk />;
  }
}

function Root() {
  const [, redraw] = useState(0);
  useEffect(() => app.subscribe(() => redraw((n) => n + 1)), []);
  const route = app.route;
  // A new key per screen in the stack, so going back shows a fresh copy of the screen below.
  return <Screen key={`${app.stack.length}:${route.to}`} route={route} />;
}

app.boot(isApple() && !isInstalled()).then(() => render(<Root />, document.getElementById('app')!));

// The Android app carries its files inside; only the website needs a service worker for offline use.
if (import.meta.env.PROD && 'serviceWorker' in navigator && !('Capacitor' in window)) navigator.serviceWorker.register('./sw.js');
if (import.meta.env.DEV) import('./dev').then((dev) => dev.install());
