import { capsule } from "@tinkered/core";

import { issueApi, issueBoard } from "./contract";

export const issues = capsule({ label: "issues", exports: { board: issueBoard, api: issueApi } });
