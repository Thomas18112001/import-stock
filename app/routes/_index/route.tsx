import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const search = url.search || "";
  throw redirect(`reassorts-magasin${search}`);
};

export default function IndexRoute() {
  return null;
}
