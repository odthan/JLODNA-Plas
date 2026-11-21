// Son d'interface JLODNA Plas. Désactivable : localStorage.setItem('jl_sound', 'off')
let audio;
export const soundEnabled = () => { try { return localStorage.getItem('jl_sound') !== 'off'; } catch { return true; } };
export const setSoundEnabled = (on) => { try { localStorage.setItem('jl_sound', on ? 'on' : 'off'); } catch {} };
export function playSound() {
  if (!soundEnabled()) return;
  try {
    audio ||= Object.assign(new Audio('/assets/sounds/son.mp3'), { preload: 'auto', volume: 0.6 });
    audio.currentTime = 0;
    audio.play().catch(() => {}); // bloqué par le navigateur avant la 1re interaction : on ignore
  } catch {}
}
