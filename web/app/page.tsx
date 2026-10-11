import { Board } from "@/components/Board";
import { CheckForm } from "@/components/CheckForm";
import { Learning, MoodGauge, TipNote } from "@/components/Home";
import { SlotRiver } from "@/components/SlotRiver";
import s from "./page.module.css";

const STEPS = [
  {
    title: "Measures every tip",
    body: "Tipwise streams every block from Solami as it is made and records every tip that got a transaction into it. That is the going rate, not a guess.",
  },
  {
    title: "Prices your fare",
    body: "Pick how fast you need to land. Tipwise picks the cheapest tip that has landed that fast often enough, and tells you the honest chance.",
  },
  {
    title: "Proves it with receipts",
    body: "Every send gets a receipt that says when it landed or why it did not. Tipwise also pays for its own test trips to check its promises.",
  },
];

export default function Home() {
  return (
    <div className="wrap">
      <section className={s.hero}>
        <div className={s.lede}>
          <h1 className="h1">The going rate to get into the next Solana block.</h1>
          <p className="lede">
            A block leaves every 0.4 seconds. Tipwise watches every tip that gets a transaction into one, and tells you what to pay right now.
          </p>
        </div>
        <div className={s.mood}>
          <MoodGauge />
        </div>
      </section>

      <div className={s.boardWrap}>
        <Board />
        <TipNote />
      </div>
      <Learning />
      <div className={s.moodMobile}>
        <MoodGauge />
      </div>

      <section className={s.river} aria-labelledby="river-title">
        <div className={s.riverHead}>
          <h2 id="river-title" className="h2">
            Every tip, live
          </h2>
          <p className="small muted">Each dot is a tip that got a transaction into a block. The band is the going rate.</p>
        </div>
        <SlotRiver />
        <p className={`small muted ${s.riverNote}`}>
          Most of these tips are Jito bundle tips, which can be tiny. Beam, which Tipwise sends through, only takes tips above the dashed line, so the
          fares on the board are priced among those.
        </p>
      </section>

      <section className={s.check} aria-labelledby="check-title">
        <h2 id="check-title" className="h2">
          Check what a wallet pays to get in.
        </h2>
        <div className={s.checkForm}>
          <CheckForm />
        </div>
      </section>

      <section className={s.how} aria-labelledby="how-title">
        <h2 id="how-title" className="h2">
          How it works
        </h2>
        <div className={s.steps}>
          {STEPS.map((step) => (
            <div key={step.title}>
              <h3 className="h3">{step.title}</h3>
              <p className="muted">{step.body}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
