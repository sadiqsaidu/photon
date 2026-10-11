import Link from "next/link";
import { Flaps } from "@/components/Flap";
import s from "./not-found.module.css";

export default function NotFound() {
  return (
    <div className="wrap">
      <section className={s.page}>
        <div className={s.board} role="img" aria-label="Departure board: page not found">
          <span className={s.label}>Status</span>
          <Flaps text="DEPARTED" length={8} className={s.flaps} />
        </div>
        <h1 className="h1">This block already left.</h1>
        <p className="lede">The page you asked for is not on the timetable. The next block leaves in 0.4 seconds, and the live board is one click away.</p>
        <div className={s.actions}>
          <Link href="/" className="btn primary">
            Go to the live board
          </Link>
          <Link href="/check" className="btn">
            Check a wallet
          </Link>
        </div>
      </section>
    </div>
  );
}
