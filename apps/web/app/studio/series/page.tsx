import { listLibrary } from "@/lib/library";
import { listProjectSummaries } from "@/lib/projects";
import { LibraryHome } from "@/components/studio/LibraryHome";
export const dynamic = "force-dynamic";
export const metadata = { title: "Series — podframes" };
export default async function SeriesPage() {
  return (
    <LibraryHome
      section="series"
      initial={await listLibrary()}
      projects={await listProjectSummaries()}
    />
  );
}
