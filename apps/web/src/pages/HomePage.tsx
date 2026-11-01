const principles = [
  {
    number: '01',
    title: 'Your choice comes first',
    description:
      'Location sharing is always voluntary. Each person can see when sharing is on, pause it, or revoke consent.',
  },
  {
    number: '02',
    title: 'Safety without surveillance',
    description:
      'FamShield is designed for family coordination, with no covert tracking or administrator bypasses.',
  },
  {
    number: '03',
    title: 'Built to earn your trust',
    description:
      'Clear permissions and careful handling of sensitive information are foundational—not add-ons.',
  },
];

export function HomePage() {
  return (
    <>
      <section className="relative overflow-hidden bg-white">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-36 -top-40 size-[30rem] rounded-full bg-brand-mist/80 blur-3xl"
        />
        <div className="relative mx-auto grid max-w-7xl items-center gap-12 px-5 py-20 sm:px-8 sm:py-28 lg:grid-cols-[1.1fr_0.9fr] lg:gap-16">
          <div className="max-w-2xl">
            <span className="inline-flex items-center gap-2 rounded-full bg-brand-mist px-3.5 py-1.5 text-sm font-medium text-brand-blue">
              <span aria-hidden="true" className="size-2 rounded-full bg-brand-teal" />
              Family safety, with trust at the center
            </span>
            <h1 className="mt-7 text-4xl font-semibold leading-tight tracking-tight text-brand-navy sm:text-5xl lg:text-6xl">
              Stay close.
              <br />
              <span className="text-brand-teal">Feel secure.</span>
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-8 text-slate-600">
              FamShield is being built to help families stay connected, coordinate with confidence,
              and look out for one another—on everyone’s terms.
            </p>
            <div className="mt-9 flex flex-wrap items-center gap-4">
              <a
                className="rounded-full bg-brand-navy px-6 py-3 text-sm font-semibold text-white shadow-soft transition hover:bg-brand-blue"
                href="#principles"
              >
                Discover our principles
              </a>
              <span className="text-sm text-slate-500">
                A thoughtful foundation for safer connection.
              </span>
            </div>
          </div>

          <div className="mx-auto w-full max-w-md">
            <div className="rounded-[2rem] border border-slate-200 bg-brand-canvas p-4 shadow-soft sm:p-6">
              <div className="rounded-2xl bg-white p-5 sm:p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-slate-500">Your family, your choice</p>
                    <p className="mt-1 text-lg font-semibold text-brand-navy">Sharing controls</p>
                  </div>
                  <span
                    aria-hidden="true"
                    className="grid size-11 place-items-center rounded-full bg-brand-mist text-brand-teal"
                  >
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      className="size-5"
                      stroke="currentColor"
                      strokeWidth="1.8"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M12 3.75 5.25 6v5.25c0 4.12 2.8 7.98 6.75 9 3.95-1.02 6.75-4.88 6.75-9V6L12 3.75Z"
                      />
                      <path strokeLinecap="round" strokeLinejoin="round" d="m9 12 2 2 4-4" />
                    </svg>
                  </span>
                </div>
                <div className="mt-7 rounded-xl border border-slate-100 bg-slate-50 p-4">
                  <div className="flex items-start gap-3">
                    <span
                      aria-hidden="true"
                      className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-full bg-white text-brand-blue shadow-sm"
                    >
                      <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        className="size-4"
                        stroke="currentColor"
                        strokeWidth="1.8"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M12 21s7-5.3 7-11a7 7 0 1 0-14 0c0 5.7 7 11 7 11Z"
                        />
                        <circle cx="12" cy="10" r="2.25" />
                      </svg>
                    </span>
                    <div>
                      <p className="text-sm font-semibold text-brand-navy">
                        Location sharing is yours
                      </p>
                      <p className="mt-1 text-sm leading-6 text-slate-600">
                        Choose whether to share. Pause or revoke access whenever you want.
                      </p>
                    </div>
                  </div>
                </div>
                <div className="mt-4 flex items-center gap-2 text-xs font-medium text-slate-500">
                  <span aria-hidden="true" className="size-1.5 rounded-full bg-brand-teal" />
                  No location is collected by this preview
                </div>
              </div>
              <div className="px-2 pb-1 pt-4 text-center text-xs text-slate-500">
                A design direction—not a live tracking screen
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id="principles" className="mx-auto max-w-7xl px-5 py-20 sm:px-8 sm:py-24">
        <div className="max-w-2xl">
          <p className="text-sm font-semibold uppercase tracking-[0.16em] text-brand-teal">
            Our foundation
          </p>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight text-brand-navy sm:text-4xl">
            Safety should feel like support.
          </h2>
          <p className="mt-4 leading-7 text-slate-600">
            The best family tools respect the people who use them. These principles guide every
            feature we build.
          </p>
        </div>
        <div className="mt-10 grid gap-5 md:grid-cols-3">
          {principles.map((principle) => (
            <article
              key={principle.number}
              className="rounded-card border border-slate-200 bg-white p-6"
            >
              <span className="text-sm font-semibold text-brand-teal">{principle.number}</span>
              <h3 className="mt-4 text-lg font-semibold text-brand-navy">{principle.title}</h3>
              <p className="mt-3 text-sm leading-6 text-slate-600">{principle.description}</p>
            </article>
          ))}
        </div>
      </section>
    </>
  );
}
