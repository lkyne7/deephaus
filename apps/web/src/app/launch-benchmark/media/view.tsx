'use client';
import { useEffect, useRef, useState } from 'react';
import { OfflineMediaLibrary, setActiveMedia, setActiveMediaVerifier, ensureCardMedia, type MediaReadiness } from '@deephaus/shared';
import { browserMediaStorage, clearActiveMediaCache, useMediaUri } from '@/lib/offline/media';

/** Exercises the real browser adapter using only the public app icon and disposable storage. */
export function MediaStorageCheck() {
  const [state, setState] = useState<MediaReadiness | null>(null);
  const [source, setSource] = useState('');
  const [grade, setGrade] = useState('');
  const manager = useRef<OfflineMediaLibrary | null>(null);
  const uri = useMediaUri(source);
  useEffect(() => {
    let active = true;
    const url = `${location.origin}/icon-512.png`;
    setSource(url);
    const storage = browserMediaStorage('launch-browser-media-fixture');
    const library = new OfflineMediaLibrary(storage, (next, entries) => {
      if (active) { setState(next); setActiveMedia(entries); }
    });
    manager.current = library;
    setActiveMediaVerifier(urls => library.verify(urls));
    void library.initialize().then(() => library.reconcile([url], true));
    return () => { active = false; library.stop(); setActiveMedia([]); setActiveMediaVerifier(null); clearActiveMediaCache(); };
  }, []);
  async function checkGrade() {
    try { await ensureCardMedia({front: `<img src="${source}">`}); setGrade('Card complete'); }
    catch { setGrade('Card deferred: media unavailable'); }
  }
  return <main style={{padding: 32}}>
    <h1>Browser media storage check</h1>
    <p>Synthetic media only. This checks browser storage and rendering, not PowerSync or the offline app shell.</p>
    <p role="status">{state ? `${state.state}: ${state.downloaded}/${state.total}` : 'Checking storage'}</p>
    {state?.error && <p role="alert">{state.error}</p>}
    <button onClick={() => void manager.current?.run(true)}>Download or retry</button>
    <button onClick={() => void checkGrade()}>Check card completeness</button>
    <p>{grade}</p>
    {/* Native img verifies the blob produced by the study renderer without Next image optimization. */}
    {/* eslint-disable-next-line @next/next/no-img-element */}
    {uri && <img src={uri} alt="Downloaded card fixture" width={128} height={128} />}
  </main>;
}
