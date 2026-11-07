import { LiveRoom } from "./live-room";

export const metadata = { title: "Live room" };

/** Every "Live room" link points here: the lot open right now, or a clear "no bidding" message. */
export default function LiveRoomPage() {
  return <LiveRoom />;
}
