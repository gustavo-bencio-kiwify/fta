import type { WebClient } from "@slack/web-api";
import { homeView } from "../views/homeView";

export async function publishHome(slack: WebClient, userId: string) {
  await slack.views.publish({
    user_id: userId,
    view: homeView(),
  });
}
