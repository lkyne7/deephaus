"use client";

import { NavBar } from "@/components/auth-panel";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { Project } from "@sluggo/shared";

export default function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [name, setName] = useState("");
  const [deckName, setDeckName] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function loadProjects() {
    setLoading(true);
    try {
      const res = await fetch("/api/projects");
      if (!res.ok) throw new Error(await res.text());
      setProjects(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load projects");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadProjects();
  }, []);

  async function createProject(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const res = await fetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, deck_name: deckName }),
    });
    if (!res.ok) {
      setError(await res.text());
      return;
    }
    setName("");
    setDeckName("");
    await loadProjects();
  }

  return (
    <>
      <NavBar />
      <main className="container stack">
        <h1>Projects</h1>

        <form className="card stack" onSubmit={createProject}>
          <h2>New project</h2>
          <label className="label">Project name</label>
          <input
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Biochemistry midterm"
            required
          />
          <label className="label">Anki deck name</label>
          <input
            className="input"
            value={deckName}
            onChange={(e) => setDeckName(e.target.value)}
            placeholder="Biochem::Midterm"
            required
          />
          <button className="btn btn-primary" type="submit">
            Create project
          </button>
        </form>

        {error && <p className="muted">{error}</p>}
        {loading ? (
          <p className="muted">Loading…</p>
        ) : projects.length === 0 ? (
          <p className="muted">No projects yet.</p>
        ) : (
          <div className="grid">
            {projects.map((project) => (
              <Link key={project.id} href={`/projects/${project.id}`} className="card">
                <h3>{project.name}</h3>
                <p className="muted">Deck: {project.deck_name}</p>
              </Link>
            ))}
          </div>
        )}
      </main>
    </>
  );
}
