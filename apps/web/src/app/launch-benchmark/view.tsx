'use client';
import { useMemo, useState } from 'react';
import { DashboardDecksTable } from '@/components/dashboard/dashboard-decks-table';

/** Synthetic data only; this route is unavailable outside the launch runner. */
export function LibraryBenchmark() {
  const [cards, setCards] = useState(1000);
  const decks = useMemo(() => Array.from({length:cards/25},(_,index)=>({
    deck_id: `00000000-0000-4000-8000-${String(index).padStart(12,'0')}`,
    name: `Fixture deck ${String(index).padStart(5,'0')}`,
    total: 25, due: 5, new: 10, new_card_count: 10, last_reviewed: null,
  })),[cards]);
  return <main style={{padding:32}}>
    <h1>Library rendering benchmark</h1>
    <p>Synthetic library: 25 cards per deck. No account data is used.</p>
    <div role="group" aria-label="Library size">
      {[1000,10000,50000].map(count=><button key={count} onClick={()=>setCards(count)} aria-pressed={cards===count}>{count.toLocaleString()} cards</button>)}
    </div>
    <DashboardDecksTable key={cards} decks={decks} onDeckSelect={()=>{}} />
  </main>;
}
