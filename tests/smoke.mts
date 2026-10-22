import { JSDOM } from 'jsdom';
const dom = new JSDOM('<!doctype html><div id="root"></div>', { pretendToBeVisual: true, url: 'http://localhost/' });
const g: any = globalThis;
g.window = dom.window; g.document = dom.window.document; g.localStorage = dom.window.localStorage; g.HTMLElement = dom.window.HTMLElement; g.Node = dom.window.Node;
Object.defineProperty(g, 'navigator', { value: dom.window.navigator, configurable: true });
g.IS_REACT_ACT_ENVIRONMENT = false;
const errors: string[] = [];
const origErr = console.error; console.error = (...a: any[]) => { errors.push(a.map(String).join(' ').slice(0, 300)); };
const React = await import('react');
const { createRoot } = await import('react-dom/client');
const { default: App } = await import('../src/App.tsx');
const root = createRoot(document.getElementById('root')!);
root.render(React.createElement(App));
const wait = (ms: number) => new Promise(r => setTimeout(r, ms));
await wait(500);
const txt = () => document.body.textContent || '';
console.log('dashboard ok:', txt().includes('Agentkontoret'), txt().includes('AIEmma'), txt().includes('Til godkjenning'));
const click = (label: string) => { const b = [...document.querySelectorAll('button')].find(x => x.textContent?.includes(label)) as HTMLButtonElement; if (!b) throw new Error('no button '+label); b.click(); };
// open a case with pending draft
click('Kari Nordvik'); await wait(300);
console.log('detail open:', txt().includes('AI-forslag'), txt().includes('Godkjenn og send'));
click('Godkjenn og send'); await wait(1600);
console.log('sent confirmed:', txt().includes('Bekreftet sendt'));
click('Simuler kundesvar'); await wait(5000);
console.log('reply+quote draft:', txt().includes('tilbudsutkast'), txt().includes('kr 14'));
// tabs
for (const t of ['Saker','Innboks','Logg','Innstillinger']) { (document.querySelector('[aria-label="Lukk"]') as HTMLButtonElement)?.click(); await wait(100); click(t); await wait(200); }
console.log('settings:', txt().includes('Automatiseringsnivå'));
click('Logg'); await wait(100); click('Revisjonslogg'); await wait(100);
console.log('audit has send_confirmed:', txt().includes('email.send_confirmed'));
// simulate inbound
click('Simuler henvendelse'); await wait(200); click('Send inn e-posten'); await wait(9000);
console.log('simulated case:', txt().includes('Marte Sandnes'));
console.log('errors:', errors.length, errors.slice(0,5));
process.exit(0);
