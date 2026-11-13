// Keys and mouse. Keys are read by physical position (event.code), so the same keys
// work on AZERTY (ZQSD) and QWERTY (WASD) keyboards.

const TOGGLES = { KeyL: 1, KeyH: 1, KeyM: 1 };
const SWALLOW = { Space: 1, ArrowUp: 1, ArrowDown: 1, ArrowLeft: 1, ArrowRight: 1, Tab: 1 };

export function makeInput(target) {
  const keys = new Set();
  let mouse2 = false, dragging = false, lx = 0, ly = 0;
  const inp = {
    state: { fwd: 0, strafe: 0, run: false, turn: 0, pull: false },
    locked: false,      // true while the browser has captured the mouse
    onToggle: null,     // called with 'KeyL' | 'KeyH' | 'KeyM'
  };
  const k = (c) => (keys.has(c) ? 1 : 0);

  function refresh() {
    const s = inp.state;
    s.fwd = Math.max(k('KeyW'), k('ArrowUp')) - Math.max(k('KeyS'), k('ArrowDown'));
    s.strafe = k('KeyD') - k('KeyA');
    s.turn = k('ArrowRight') - k('ArrowLeft');
    s.run = !!(k('ShiftLeft') || k('ShiftRight'));
    s.pull = !!(k('Space') || mouse2);
  }

  inp.handle = (e) => {
    switch (e.type) {
      case 'keydown':
        if (!e.repeat && TOGGLES[e.code] && inp.onToggle) inp.onToggle(e.code);
        keys.add(e.code);
        if (SWALLOW[e.code] && e.preventDefault) e.preventDefault();
        break;
      case 'keyup': keys.delete(e.code); break;
      case 'blur': keys.clear(); mouse2 = false; dragging = false; break;
      case 'mousedown':
        if (e.button === 2) mouse2 = true;
        if (e.button === 0) dragging = true;
        break;
      case 'mouseup':
        if (e.button === 2) mouse2 = false;
        if (e.button === 0) dragging = false;
        break;
      case 'mousemove':
        // Without mouse capture (page embedded in a frame), dragging looks around instead.
        if (inp.locked || dragging) { lx += e.movementX || 0; ly += e.movementY || 0; }
        break;
      case 'contextmenu': if (e.preventDefault) e.preventDefault(); break;
    }
    refresh();
  };

  inp.consumeLook = () => { const r = { dx: lx, dy: ly }; lx = 0; ly = 0; return r; };

  if (target && target.addEventListener) {
    for (const type of ['keydown', 'keyup', 'blur', 'mousedown', 'mouseup', 'mousemove', 'contextmenu']) {
      target.addEventListener(type, inp.handle);
    }
  }
  return inp;
}
