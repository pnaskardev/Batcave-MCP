import { resumeReview } from "./features/resume-review";
import type { ToolModule } from "./module";

/** Everything this server exposes. Both entrypoints mount exactly this list. */
export const modules: readonly ToolModule[] = [resumeReview];
