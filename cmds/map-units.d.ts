declare module "map:units" {
  import type { ReactElement } from "react";

  import type { ShowUnits } from "@/map/show";

  export const shown: ShowUnits & { View: () => ReactElement };
}
