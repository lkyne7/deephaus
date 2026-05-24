import Link from "next/link";
import { AuthPanel, NavBar } from "@/components/auth-panel";

export default function HomePage() {
  return (
    <>
      <NavBar />
      <main className="container">
        <section className="hero">
          <h1>Turn study material into Anki decks</h1>
          <p>
            Paste notes or upload PDFs. Sluggo drafts Basic and Cloze cards, lets you
            review them, and exports a ready-to-import .apkg file.
          </p>
          <Link href="/projects" className="btn btn-primary">
            Go to projects
          </Link>
        </section>
        <section className="card stack" style={{ maxWidth: 420, margin: "0 auto" }}>
          <h2>Sign in</h2>
          <AuthPanel />
        </section>
      </main>
    </>
  );
}
