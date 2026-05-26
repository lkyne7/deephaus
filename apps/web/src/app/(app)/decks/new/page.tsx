import { PageHeader } from "@/components/page-header";
import { CreateDeckForm } from "@/components/create-deck-form";

export default function NewDeckPage() {
  return (
    <>
      <PageHeader title="Create Deck" />
      <div style={{ padding: "32px 40px", maxWidth: 880, width: "100%" }}>
        <CreateDeckForm />
      </div>
    </>
  );
}
