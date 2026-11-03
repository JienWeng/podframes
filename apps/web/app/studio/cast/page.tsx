import { listLibrary } from "@/lib/library";
import { listProjectSummaries } from "@/lib/projects";
import { LibraryHome } from "@/components/studio/LibraryHome";
export const dynamic = "force-dynamic";
export const metadata = { title: "Cast — podframes" };
export default async function CastPage() {
  return (
    <LibraryHome
      section="cast"
      initial={await listLibrary()}
      projects={await listProjectSummaries()}
    />
  );
}
