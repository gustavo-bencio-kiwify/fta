// src/slack/views/homeView.ts
import type { HomeView } from "@slack/web-api";
import { homeHeaderActionsBlocks } from "./homeHeaderActions";
import { homeTasksBlocks, type HomeTaskItem } from "./homeTasksBlocks";

export function homeView(args: {
  tasksToday: HomeTaskItem[];
  tasksTomorrow: HomeTaskItem[];
  tasksFuture: HomeTaskItem[];
}): HomeView {
  return {
    type: "home",
    blocks: [
      ...homeHeaderActionsBlocks(),
      ...homeTasksBlocks(args),
    ],
  };
}
