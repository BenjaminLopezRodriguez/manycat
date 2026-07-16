import { HydrateClient } from "@/trpc/server";
import Chat from "./_fragments/chat/chat";

export default async function Home() {
  return (
    <HydrateClient>
      <Chat />
    </HydrateClient>
  );
}
