/** Titles of generation tasks started from typed input rather than a file. */
const TYPED_GENERATION_TITLES = new Set(["Generating cards", "YouTube import", "Website import"]);

/**
 * What to tell someone about a task the app was closed in the middle of, before
 * it had a server job to pick back up. Only a file upload can be resumed by
 * choosing the file again; a topic, notes or link has to be sent again.
 */
export function interruptedTaskMessage(task: { kind: string; title: string }): string {
  if (
    task.kind === "generation" &&
    (TYPED_GENERATION_TITLES.has(task.title) || task.title.startsWith("Topic: "))
  ) {
    return "This stopped before it started because the app closed. Send it again to make the cards.";
  }
  if (task.kind === "anki-export") {
    return "This export was interrupted when the app closed. Start it again.";
  }
  return "This upload was interrupted when the app closed. Select the file to resume it.";
}
