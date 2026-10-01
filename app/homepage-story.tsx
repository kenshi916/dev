"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import {
  Activity,
  ArrowDown,
  ArrowUpRight,
  Megaphone,
  Banknote,
  Eye,
  Pause,
  Play,
  Repeat2,
  Terminal,
  Zap,
} from "lucide-react";

const WALLET = "bwamJzztZsepfkteWRChggmXuiiCQvpLqPietdNfSXa";
const phases = [
  {
    label: "Force-feed the narrative",
    title: "Sell the story. Push the urgency.",
    text: "Constant hype pressures traders to act before they can question the launch or the people behind it.",
    icon: Megaphone,
  },
  {
    label: "Drive buy pressure",
    title: "Attention becomes exit liquidity.",
    text: "In an extractive launch, incoming traders become the liquidity the dev plans to sell into.",
    icon: Zap,
  },
  {
    label: "Cash out",
    title: "The dev cashes out. Traders carry the risk.",
    text: "When extracting as much money as possible is the goal, the community is left with the downside.",
    icon: Banknote,
  },
  {
    label: "Repeat the cycle",
    title: "Another payday. A weaker space.",
    text: "Repeat it across new tickers and extraction becomes the business model. Capital and trust leave with it.",
    icon: Repeat2,
  },
];
const snapshots = [
  {
    name: "bwa",
    address: "bwam…fSXa",
    wallet: WALLET,
    pnl: "+$21.9M",
    image: "/images/bwa-wallet-snapshot.png",
    width: 1404,
    height: 406,
    activityImage: "/images/bwa-activity-snapshot.png",
  },
  {
    name: "kreo",
    address: "BCnq…dArc",
    wallet: "",
    pnl: "+$2.93M",
    image: "/images/kreo-wallet-snapshot.png",
    width: 1412,
    height: 416,
  },
];

function useInView<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!ref.current) return;
    const observer = new IntersectionObserver(
      ([entry]) => setVisible(entry.isIntersecting),
      { threshold: 0.15 },
    );
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  return [ref, visible] as const;
}

export default function HomepageStory({
  onTerminal,
  onWallet,
}: {
  onTerminal: () => void;
  onWallet: () => void;
}) {
  const [storyRef, inView] = useInView<HTMLElement>();
  const [walletRef, walletVisible] = useInView<HTMLElement>();
  const [phase, setPhase] = useState(0);
  const [paused, setPaused] = useState(false);
  const [reduced, setReduced] = useState(true);
  useEffect(() => {
    const preference = matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(preference.matches);
    update();
    preference.addEventListener("change", update);
    return () => preference.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    if (!inView || paused || reduced) return;
    const interval = setInterval(() => {
      if (!document.hidden) setPhase((p) => (p + 1) % phases.length);
    }, 3200);
    return () => clearInterval(interval);
  }, [inView, paused, reduced]);
  const Icon = phases[phase].icon;
  const animating = inView && !paused && !reduced;
  return (
    <div className="homepage-story">
      <section
        ref={storyRef}
        className={`space-problem ${animating ? "is-animating" : ""}`}
        aria-labelledby="space-problem-title"
      >
        <div className="story-section-label">
          <span>01 / THE PROBLEM</span>
          <span>LET’S TALK ABOUT THE PLAYBOOK</span>
        </div>
        <div className="problem-layout">
          <div className="problem-copy">
            <h2 id="space-problem-title">
              New ticker.
              <br />
              <em>Same extraction cycle.</em>
            </h2>
            <p>
              Force-feed a narrative. Turn attention into buy pressure. Cash
              out. Repeat. When devs make extraction the business model, traders
              become someone else’s exit liquidity. Money leaves the community,
              confidence breaks, and the next ticker starts the cycle again.
            </p>
            <p className="problem-principle">
              A community deserves more than another cash-out.
              <br />
              <strong>
                This is the cycle the memecoin space needs to break.
              </strong>
            </p>
            <button className="story-text-link" onClick={onTerminal}>
              Build around a thesis people can inspect{" "}
              <ArrowUpRight size={16} />
            </button>
          </div>
          <div
            className="playbook-animation"
            aria-label="Animation of the extraction cycle"
          >
            <div className="playbook-top">
              <span>
                <Activity size={12} /> THE EXTRACTION CYCLE
              </span>
              <button
                onClick={() => setPaused(!paused)}
                disabled={reduced}
                aria-label={
                  paused
                    ? "Play homepage animation"
                    : "Pause homepage animation"
                }
              >
                {paused || reduced ? <Play size={12} /> : <Pause size={12} />}{" "}
                {reduced ? "Reduced motion" : paused ? "Play" : "Pause"}
              </button>
            </div>
            <div className="playbook-scene" aria-hidden="true">
              <div className="cycle-orbit orbit-one" />
              <div className="cycle-orbit orbit-two" />
              <div
                className={`cycle-tile tile-copy ${phase === 0 ? "is-current" : ""}`}
              >
                <Megaphone size={17} />
                <span>FEED THE HYPE</span>
                <small>push the story</small>
              </div>
              <div
                className={`cycle-tile tile-launch ${phase === 1 ? "is-current" : ""}`}
              >
                <Zap size={17} />
                <span>BUY PRESSURE</span>
                <small>traders pile in</small>
              </div>
              <div
                className={`cycle-tile tile-silence ${phase === 2 ? "is-current" : ""}`}
              >
                <Banknote size={17} />
                <span>CASH OUT</span>
                <small>extract value</small>
              </div>
              <div
                className={`cycle-tile tile-repeat ${phase === 3 ? "is-current" : ""}`}
              >
                <Repeat2 size={17} />
                <span>NEXT TICKER</span>
                <small>repeat the cycle</small>
              </div>
              <div className="cycle-core">
                <Repeat2 size={30} />
                <span>REPEAT</span>
              </div>
              <span className="cycle-particle particle-one" />
              <span className="cycle-particle particle-two" />
            </div>
            <div className="playbook-caption">
              <Icon size={17} />
              <div>
                <strong>{phases[phase].title}</strong>
                <p>{phases[phase].text}</p>
              </div>
            </div>
            <div
              className="playbook-controls"
              aria-label="Explore the extraction cycle"
            >
              {phases.map((p, i) => (
                <button
                  key={p.label}
                  onClick={() => {
                    setPhase(i);
                    setPaused(true);
                  }}
                  aria-label={p.label}
                  aria-pressed={phase === i}
                >
                  <span>0{i + 1}</span>
                  <i className={phase === i ? "selected" : ""} />
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="story-bridge">
          <span />
          <ArrowDown size={16} />
          <b>START WITH WHAT YOU CAN OBSERVE.</b>
          <span />
        </div>
      </section>

      <section
        ref={walletRef}
        className={`wallet-study ${walletVisible ? "wallet-revealed" : ""}`}
        aria-labelledby="wallet-study-title"
      >
        <div className="story-section-label">
          <span>02 / THE WALLET STUDIES</span>
          <span>WALLET SNAPSHOTS</span>
        </div>
        <div className="wallet-study-heading">
          <div>
            <span className="story-kicker">
              $20M+ IN THE SUPPLIED BWA SNAPSHOT
            </span>
            <h2 id="wallet-study-title">
              Follow the money.
              <br />
              <em>Ask better questions.</em>
            </h2>
          </div>
          <p>
            These screenshots show the reported PNL. Understanding the trading
            behind those numbers takes transaction history, context, and a
            closer look.
          </p>
        </div>
        <div className="wallet-screenshots">
          {snapshots.map((snapshot, i) => (
            <figure
              className="wallet-screenshot"
              key={snapshot.name}
              style={{ "--reveal-delay": i * 140 + "ms" } as CSSProperties}
            >
              <figcaption className="snapshot-heading">
                <div>
                  <span className="story-kicker">
                    ORIGINAL SCREENSHOT / 0{i + 1}
                  </span>
                  <h3>
                    {snapshot.name} <span>{snapshot.address}</span>
                  </h3>
                </div>
                <div className="snapshot-pnl">
                  <small>REPORTED REALIZED PNL</small>
                  <strong>{snapshot.pnl}</strong>
                </div>
              </figcaption>
              <a
                className="snapshot-image-link"
                href={snapshot.image}
                target="_blank"
                rel="noreferrer"
                aria-label={
                  "Open original " + snapshot.name + " screenshot at full size"
                }
              >
                <img
                  src={snapshot.image}
                  width={snapshot.width}
                  height={snapshot.height}
                  loading="lazy"
                  alt={
                    "Original supplied wallet tracker screenshot labeled " +
                    snapshot.name +
                    ", showing total and realized PNL of " +
                    snapshot.pnl +
                    "."
                  }
                />
              </a>
              {snapshot.activityImage && (
                <a
                  className="snapshot-image-link snapshot-activity-link"
                  href={snapshot.activityImage}
                  target="_blank"
                  rel="noreferrer"
                  aria-label="Open original bwa activity screenshot at full size"
                >
                  <img
                    src={snapshot.activityImage}
                    width={784}
                    height={50}
                    loading="lazy"
                    alt="Original supplied activity row screenshot labeled bwa."
                  />
                </a>
              )}
              {snapshot.wallet && (
                <div className="snapshot-actions">
                  <button onClick={onWallet}>
                    Create your agent <Eye size={12} />
                  </button>
                </div>
              )}
            </figure>
          ))}
        </div>
        <div className="story-resolution">
          <div className="story-dev-mark">
            <Terminal size={21} />
          </div>
          <div>
            <span className="story-kicker">
              A DIFFERENT STANDARD FOR YOUR DEV
            </span>
            <h3>
              The cycle needs to change.
              <br />
              <em>Build with the community.</em>
            </h3>
            <p>
              Dev puts the thesis, source signals, and counterarguments where
              people can inspect them. The standard we want: original ideas,
              visible decisions, and communities that help shape what comes
              next.
            </p>
          </div>
          <button className="button primary" onClick={onTerminal}>
            Open the thesis room <ArrowUpRight size={16} />
          </button>
        </div>
      </section>
    </div>
  );
}
