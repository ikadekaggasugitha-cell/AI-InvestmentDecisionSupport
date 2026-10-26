import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { PublicFeatures } from "./PublicFeatures";

/**
 * The second public surface, reached from the price sheet's "Fitur" link
 * (owner, 2026-10-23). The rules this suite pins:
 *
 *  - Every claim names a view that exists. The inventory is the sidebar's
 *    own vocabulary (Dashboard, Pasar, Portofolio, AI Advisor, Berita,
 *    Laporan, Pengaturan, Peringatan), the four pillars expand the sheet's
 *    band, and the examples reuse wording the app itself shows.
 *  - Examples stay labelled. The sample lines the app shows under "Data
 *    contoh" are quoted as samples here too, never as live claims.
 *  - The demo is evidence, not decoration: a real screen recording of the
 *    app (C-5). Its element waits for the visitor (no autoplay attribute);
 *    when motion is allowed the recording starts in view and pauses out of
 *    it, and reduced-motion visitors get the poster and their own play.
 *  - Navigation walks inside the app: the hrefs stay real (middle-click,
 *    sharing) while clicks go through handlers. "Hubungi kami" stays held
 *    exactly as on the sheet until the owner names its channel.
 *  - Motion is one-time, small (DIAL MOTION 2 for this screen), and never
 *    arms without IntersectionObserver or under reduced motion.
 */
function renderFeatures(locale: "id" | "en" = "id", overrides: Partial<Parameters<typeof PublicFeatures>[0]> = {}) {
  const handlers = {
    onEnter: vi.fn(),
    onSignUp: vi.fn(),
    onViewPricing: vi.fn(),
    onViewNotes: vi.fn(),
    ...overrides,
  };
  const utils = render(<PublicFeatures locale={locale} {...handlers} />);
  return { ...utils, handlers };
}

describe("PublicFeatures", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("states the screen's job once, in the sheet's type system", () => {
    const { container } = renderFeatures();
    expect(screen.getByRole("heading", { name: "Setiap alat bantu datang dengan alasannya." })).toBeInTheDocument();
    expect(screen.getByText("FITUR")).toBeInTheDocument();
    /* The hero reuses the sheet's hero classes on purpose: one type system
       across both public pages. */
    expect(container.querySelector(".pub-hero h1")).not.toBeNull();
    expect(container.querySelector(".pub-tagline")).not.toBeNull();
  });

  it("carries the four pillars the sheet's band compresses, each at its own anchor", () => {
    const { container } = renderFeatures();
    expect(screen.getByRole("heading", { name: "Sinyal AI" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Peringatan otomatis" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Panel risiko" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Optimasi portofolio" })).toBeInTheDocument();
    for (const id of ["sinyal", "peringatan", "risiko", "optimasi"]) {
      expect(container.querySelector(`#${id}`)).not.toBeNull();
    }
  });

  it("seats the demo as a real recording: controls ready, nothing autoplaying", () => {
    const { container } = renderFeatures();
    /* The recording opens the page now (owner, 2026-10-24): it lives in
       the hero, not in a band further down. */
    const heroVideo = container.querySelector(".pub-hero video");
    expect(heroVideo).not.toBeNull();
    const video = container.querySelector("video");
    expect(video).not.toBeNull();
    expect(video).toHaveAttribute("controls");
    expect(video).toHaveAttribute("poster", "/fitur-demo-poster.jpg");
    expect(video).toHaveAttribute("src", "/fitur-demo.mp4");
    expect(video).toHaveAttribute("preload", "none");
    /* No autoplay attribute: starting is the page's decision (in view, once)
       or the visitor's own touch under reduced motion. */
    expect(video).not.toHaveAttribute("autoplay");
    expect(video).toHaveAttribute("aria-label", expect.stringContaining("rekam"));
    expect(screen.getByText(/Rekaman layar nyata aplikasi/)).toBeInTheDocument();
  });

  it("names what the recording shows, in the app's own words", () => {
    const { container } = renderFeatures();
    const demoCopy = container.querySelector(".pubf-demo-copy") as HTMLElement;
    expect(within(demoCopy).getByRole("heading", { name: "Lihat aplikasi berjalan" })).toBeInTheDocument();
    expect(within(demoCopy).getByText("Ringkasan")).toBeInTheDocument();
    expect(within(demoCopy).getByText("Pasar")).toBeInTheDocument();
    expect(within(demoCopy).getByText("Sinyal AI")).toBeInTheDocument();
  });

  it("quotes real-shaped examples and keeps the sample-data label", () => {
    const { container } = renderFeatures();
    /* Four labelled example blocks: signals, alerts, risk, optimisation.
       Counted on the example head itself, so the FAQ's own sentence about
       sample data ("Contoh di halaman ini...") doesn't join the tally. */
    expect(container.querySelectorAll(".pubf-example-head")).toHaveLength(4);
    /* The lines the app itself shows on its dashboard's signals panel,
       labelled as samples exactly as the app labels them. */
    expect(screen.getByText(/BREN mendekati target/)).toBeInTheDocument();
    expect(screen.getAllByText(/Data contoh, seperti pada aplikasi/).length).toBeGreaterThan(0);
  });

  it("gives every pillar its own usage steps in the app's real vocabulary", () => {
    renderFeatures();
    expect(screen.getAllByText("Alur pemakaian di aplikasi")).toHaveLength(4);
    expect(screen.getByText("Buka panel Sinyal AI dari sidebar.")).toBeInTheDocument();
    expect(screen.getByText("Buka menu Risiko dari sidebar.")).toBeInTheDocument();
    expect(screen.getByText("Tetapkan aturan peringatan Anda di Pengaturan.")).toBeInTheDocument();
  });

  it("tells one scenario through the four pillars, labelled as sample data", () => {
    const { container } = renderFeatures();
    expect(screen.getByRole("heading", { name: "Dari sinyal ke keputusan" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Peringatan terbit" })).toBeInTheDocument();
    /* The same sample figures the example cards quote, 40.2% against the
       38% rule, carried through the scenario without a new invention. */
    expect(screen.getByText(/mencapai 40,2%/)).toBeInTheDocument();
    expect(screen.getByText(/ke target 38%/)).toBeInTheDocument();
    expect(container.querySelector(".pubf-flow-steps")?.children).toHaveLength(4);
    expect(screen.getAllByText(/Data contoh, seperti pada aplikasi/).length).toBeGreaterThan(1);
  });

  it("compares before and after with the app's own sentences and no promise", () => {
    renderFeatures();
    expect(screen.getByRole("heading", { name: "Sebelum dan sesudah" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Tanpa satu aplikasi" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Dengan AIDSS" })).toBeInTheDocument();
    expect(screen.getByText(/tanpa janji kinerja/)).toBeInTheDocument();
    /* Each side repeats wording already pinned above: same facts, twice. */
    expect(screen.getAllByText(/Peringatan terbit saat kondisi pasar memenuhi aturan yang Anda tetapkan/).length).toBeGreaterThan(1);
  });

  it("answers only questions this product's readers ask, via native disclosures", async () => {
    const user = userEvent.setup();
    renderFeatures();
    expect(screen.getByRole("heading", { name: "Pertanyaan yang benar-benar muncul" })).toBeInTheDocument();
    const questions = [
      "Apakah AIDSS yang membeli dan menjual saham untuk saya?",
      "Apa bedanya data contoh di halaman ini dengan data di aplikasi?",
      "Untuk apa AI Advisor dipakai?",
      "Kapan peringatan saya terbit?",
      "Bagaimana langganan dan pembayarannya bekerja?",
    ];
    for (const question of questions) {
      expect(screen.getByText(question).tagName).toBe("SUMMARY");
    }
    /* The disclosure opens without JavaScript wiring (R-26: a control that
       really works). */
    const first = screen.getByText(questions[0]);
    expect(screen.getAllByText(/alat bantu keputusan, bukan penasihat investasi/i).length).toBeGreaterThan(1);
    await user.click(first);
    expect((first.closest("details") as HTMLDetailsElement).open).toBe(true);
  });

  it("lets every tool card open one short example", async () => {
    const user = userEvent.setup();
    const { container } = renderFeatures();
    const disclosures = container.querySelectorAll(".pubf-tool-more");
    expect(disclosures).toHaveLength(8);
    const first = disclosures[0] as HTMLDetailsElement;
    expect(first.open).toBe(false);
    await user.click(first.querySelector("summary") as HTMLElement);
    expect(first.open).toBe(true);
    expect(first.textContent).toContain("Di aplikasi");
  });

  it("lists the devices the app actually ships", () => {
    renderFeatures();
    for (const name of ["Dashboard", "Pasar", "Portofolio", "AI Advisor", "Berita", "Laporan", "Peringatan", "Pengaturan & langganan"]) {
      expect(screen.getByRole("heading", { name })).toBeInTheDocument();
    }
  });

  it("keeps the shared furniture visible: search, currency, language", () => {
    renderFeatures();
    expect(screen.getByText(/pemilih IDR\/USD/)).toBeInTheDocument();
    expect(screen.getByText(/bahasa Indonesia\/Inggris/)).toBeInTheDocument();
  });

  it("renders nothing moving before the browser grants it: no observer, no arming", () => {
    /* jsdom has no IntersectionObserver, so the page stays in its final
       state: the armed flag is never set, the content is fully visible. */
    const { container } = renderFeatures();
    expect(container.querySelector('[data-motion="armed"]')).toBeNull();
    expect(container.querySelectorAll("[data-reveal]").length).toBeGreaterThan(0);
  });

  it("refuses the whole motion dial for reduced-motion visitors", () => {
    /* Even with an observer present, a visitor who asked for stillness gets
       none: the hook reads the media query at mount and never arms. */
    const win = window as Window & { matchMedia?: (q: string) => MediaQueryList };
    const originalMatch = win.matchMedia;
    const originalIO = window.IntersectionObserver;
    win.matchMedia = (q: string) =>
      ({ matches: q.includes("prefers-reduced-motion"), media: q }) as MediaQueryList;
    class FakeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    window.IntersectionObserver = FakeObserver as unknown as typeof IntersectionObserver;
    try {
      const { container } = renderFeatures();
      expect(container.querySelector('[data-motion="armed"]')).toBeNull();
      expect(container.querySelectorAll("[data-reveal]").length).toBeGreaterThan(0);
    } finally {
      win.matchMedia = originalMatch;
      window.IntersectionObserver = originalIO;
    }
  });

  it("arms the dial when motion is allowed, and observes every reveal", () => {
    /* The MOTION 2 gate: the root carries the armed flag only when both the
       media query and the observer exist, and every data-reveal element is
       handed to the observer for its one-time entrance. */
    const win = window as Window & { matchMedia?: (q: string) => MediaQueryList };
    const originalMatch = win.matchMedia;
    const originalIO = window.IntersectionObserver;
    win.matchMedia = (q: string) =>
      ({ matches: false, media: q }) as MediaQueryList;
    const observed: Element[] = [];
    class FakeObserver {
      observe(el: Element) {
        observed.push(el);
      }
      unobserve() {}
      disconnect() {}
    }
    window.IntersectionObserver = FakeObserver as unknown as typeof IntersectionObserver;
    try {
      const { container } = renderFeatures();
      expect(container.querySelector('[data-motion="armed"]')).not.toBeNull();
      /* All 34 data-reveal elements take their one-time entrance, and the
         demo video is under its own observer for the play-once hook. */
      expect(observed.filter((el) => el.hasAttribute("data-reveal"))).toHaveLength(
        container.querySelectorAll("[data-reveal]").length,
      );
      expect(observed).toContain(container.querySelector(".pub-hero video"));
    } finally {
      win.matchMedia = originalMatch;
      window.IntersectionObserver = originalIO;
    }
  });

  it("walks the topbar back to the sheet: Harga and the logo", async () => {
    const user = userEvent.setup();
    const { handlers, container } = renderFeatures();
    /* The links live behind the hamburger now (owner, 2026-10-24): the
       landmark only serves the reader once the menu is open. */
    await user.click(screen.getByRole("button", { name: "Buka menu navigasi" }));
    const nav = within(screen.getByRole("navigation", { name: "Navigasi layar fitur" }));
    const harga = nav.getByRole("link", { name: "Harga" });
    expect(harga).toHaveAttribute("href", "/");
    await user.click(harga);
    expect(handlers.onViewPricing).toHaveBeenCalledTimes(1);

    const logo = container.querySelector(".pubf-logo") as HTMLAnchorElement;
    expect(logo).toHaveAttribute("href", "/");
    expect(logo).toHaveAttribute("aria-label", "Ke lembar harga");
    await user.click(logo);
    expect(handlers.onViewPricing).toHaveBeenCalledTimes(2);
  });

  it("sends the topbar's Catatan across, at the disclaimer's hash", async () => {
    const user = userEvent.setup();
    const { handlers } = renderFeatures();
    await user.click(screen.getByRole("button", { name: "Buka menu navigasi" }));
    const nav = within(screen.getByRole("navigation", { name: "Navigasi layar fitur" }));
    const catatan = nav.getByRole("link", { name: "Catatan" });
    expect(catatan).toHaveAttribute("href", "/#catatan");
    await user.click(catatan);
    expect(handlers.onViewNotes).toHaveBeenCalledTimes(1);
  });

  it("runs the hamburger as a real small menu: open, Escape, outside press", async () => {
    const user = userEvent.setup();
    const { container } = renderFeatures();
    const button = screen.getByRole("button", { name: "Buka menu navigasi" });
    expect(button).toHaveAttribute("aria-expanded", "false");

    await user.click(button);
    expect(button).toHaveAttribute("aria-expanded", "true");
    expect(container.querySelector(".pub-menu-pop.is-open")).not.toBeNull();

    /* Escape closes and hands focus back to the button (R-32). */
    await user.keyboard("{Escape}");
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(document.activeElement).toBe(button);

    /* A press anywhere outside the menu closes it too. */
    await user.click(button);
    expect(button).toHaveAttribute("aria-expanded", "true");
    await user.click(screen.getByRole("heading", { name: "Setiap alat bantu datang dengan alasannya." }));
    expect(button).toHaveAttribute("aria-expanded", "false");
  });

  it("offers only destinations this screen can serve: Harga and Catatan, never itself", async () => {
    const user = userEvent.setup();
    renderFeatures();
    await user.click(screen.getByRole("button", { name: "Buka menu navigasi" }));
    const nav = within(screen.getByRole("navigation", { name: "Navigasi layar fitur" }));
    expect(nav.getByRole("link", { name: "Harga" })).toBeInTheDocument();
    expect(nav.getByRole("link", { name: "Catatan" })).toBeInTheDocument();
    expect(nav.queryByRole("link", { name: "Fitur" })).not.toBeInTheDocument();
  });

  it("keeps the enter gates standing outside the menu", async () => {
    const user = userEvent.setup();
    const { handlers } = renderFeatures();
    const menu = screen.getByRole("button", { name: "Buka menu navigasi" }).closest(".pub-menu") as HTMLElement;
    await user.click(screen.getByRole("button", { name: "Masuk" }));
    expect(handlers.onEnter).toHaveBeenCalledTimes(1);
    expect(menu.contains(screen.getByRole("button", { name: "Masuk" }))).toBe(false);
    await user.click(screen.getByRole("button", { name: "Buat akun" }));
    expect(handlers.onSignUp).toHaveBeenCalledTimes(1);
    expect(menu.contains(screen.getByRole("button", { name: "Buat akun" }))).toBe(false);
  });

  it("keeps both gates where the reader stands: Masuk and Buat akun", async () => {
    const user = userEvent.setup();
    const { handlers } = renderFeatures();
    await user.click(screen.getByRole("button", { name: "Masuk" }));
    expect(handlers.onEnter).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: "Buat akun" }));
    expect(handlers.onSignUp).toHaveBeenCalledTimes(1);
  });

  it("closes with the way back to the price the journey started at", async () => {
    const user = userEvent.setup();
    const { handlers } = renderFeatures();
    expect(screen.getByRole("heading", { name: "Siap mengujinya?" })).toBeInTheDocument();
    const cta = screen.getByRole("link", { name: /Lihat harga, masuk ke paket/ });
    expect(cta).toHaveAttribute("href", "/#harga");
    await user.click(cta);
    expect(handlers.onViewPricing).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/pembayaran dimula dari dalam aplikasi/)).toBeInTheDocument();
  });

  it("anchors the footer's products column to this page and plans to the sheet", () => {
    const { container } = renderFeatures();
    const footer = container.querySelector(".pub-footer") as HTMLElement;
    expect(within(footer).getByRole("link", { name: "Sinyal" })).toHaveAttribute("href", "#sinyal");
    expect(within(footer).getByRole("link", { name: "Peringatan otomatis" })).toHaveAttribute("href", "#peringatan");
    expect(within(footer).getByRole("link", { name: "Panel risiko" })).toHaveAttribute("href", "#risiko");
    expect(within(footer).getByRole("link", { name: "Optimasi portofolio" })).toHaveAttribute("href", "#optimasi");
    for (const name of ["Mingguan", "Bulanan", "Tahunan", "Bandingkan paket"]) {
      expect(within(footer).getByRole("link", { name })).toHaveAttribute("href", "/#harga");
    }
  });

  it("holds the contact entry open until the owner names the channel", () => {
    const { container } = renderFeatures();
    const footer = container.querySelector(".pub-footer") as HTMLElement;
    const held = within(footer).getByText("Hubungi kami");
    expect(held).toHaveAttribute("aria-disabled", "true");
    expect(held.closest("a")).toBeNull();
  });

  it("keeps the risk notes honest, at the anchor the topbar and footer cross to", () => {
    const { container } = renderFeatures();
    const disclaimer = container.querySelector("#catatan");
    expect(disclaimer).not.toBeNull();
    expect(disclaimer?.textContent).toContain("alat bantu keputusan, bukan penasihat investasi");
  });

  it("keeps the footer's live clock and copyright line", () => {
    const { container } = renderFeatures();
    const footer = container.querySelector(".pub-footer") as HTMLElement;
    expect(within(footer).getByText(/© 2026 AIDSS · MCASS/)).toBeInTheDocument();
    expect(footer.textContent).toMatch(/\d{2}:\d{2}:\d{2} WIB/);
    /* The features page shows no price date: the sheet owns that fact. */
    expect(footer.textContent).not.toContain("Harga diperbarui");
  });

  it("writes without the banned dash, everywhere", () => {
    const { container } = renderFeatures();
    expect(container.textContent).not.toContain("—");
    expect(container.textContent).not.toContain("–");
  });

  it("speaks English as the app does", async () => {
    const user = userEvent.setup();
    renderFeatures("en");
    expect(screen.getByRole("heading", { name: "Every decision aid comes with its reasoning." })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Open navigation menu" }));
    const nav = within(screen.getByRole("navigation", { name: "Features screen navigation" }));
    expect(nav.getByRole("link", { name: "Pricing" })).toBeInTheDocument();
    expect(nav.getByRole("link", { name: "Notes" })).toBeInTheDocument();
    expect(nav.queryByRole("link", { name: "Features" })).not.toBeInTheDocument();
  });
});
