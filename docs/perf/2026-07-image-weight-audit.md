# Image Weight Audit — premise falsified, and what the measuring actually found

**Date:** 2026-07-25 · **Plan:** `docs/superpowers/plans/2026-07-31-image-weight-and-durability.md` Task 1

## The plan was wrong. Task 1 existed to catch that, and it did.

The plan asserted that the product ships ~150 KB photos into card slots a few
hundred pixels wide, and that the fix was to use the `w=` parameter present on
100% of image URLs. Task 1 Step 1 said: *if the byte count does not change, the
parameter is decorative and Task 2 is pointless — stop and record that.*

**The parameter is decorative.**

```
w=200    200 119136b  960x533
w=400    200 119136b  960x533
w=640    200 119136b  960x533
w=1200   200 119136b  960x533
no param 200 119136b  960x533
```

Byte-identical at every width. The CDN ignores `w=` entirely.

Resizing *is* possible, but through the path token rather than the query string
(`…-w480_h360_x2.webp`):

| token | bytes | dimensions |
|---|---|---|
| `w480_h360_x2` (as stored) | 119,136 | 960×533 |
| `w480_h360` | 28,812 | 480×267 |
| `w320_h240` | 13,514 | 320×178 |
| `w160_h120` | 4,076 | 160×89 |

So the plan's *mechanism* was wrong but its *goal* looked achievable — until the
next measurement.

## The goal was already achieved. By code that was already there.

`apps/one` renders listing images through `<Media>` (`packages/primitives/src/media.tsx`),
which wraps `next/image`, and `next.config.ts` allowlists `*.rdcpix.com` under
`images.remotePatterns`. That means **Next fetches and resizes server-side; the
browser never receives the 119 KB original.** Measured against the live app:

```
/_next/image?url=…&w=384   14,982b   384x213
/_next/image?url=…&w=640   38,100b   640x355
/_next/image?url=…&w=828   60,098b   828x460
/_next/image?url=…&w=1080 105,932b   960x533
```

The card requests `sizes="(max-width: 768px) 100vw, (max-width: 1280px) 50vw, 33vw"`,
so a desktop browser picks roughly the 640–828 variant and a phone the 384–640
variant. **That is correct behaviour.** There is no weight problem to fix, and
`sizedPhoto()` would have been a rewrite of URLs that never reach a browser.

Tasks 2 and 3 of that plan are therefore **cancelled**, not deferred.

## What the measuring actually found: the disk is at 86%

While confirming there was no image-weight problem, the box's storage came into
view:

```
/dev/vda2  148G  121G used  21G avail  86% /
```

Breakdown:

| Consumer | Size |
|---|---|
| `/var/lib/docker` | **57 G** |
| `/var/lib/postgresql` | 21 G |
| `/opt/onepercent` | 3.9 G |
| `/var/log` | 2.5 G |
| `/root` | 2.5 G |

Docker holds more than twice what Postgres does, on a box where **the
application does not run in Docker** — only the monitoring stack does. `docker
system df`:

| Type | Total | Active | Size | Reclaimable |
|---|---|---|---|---|
| Build cache | 407 | **0** | 29.79 GB | **19.77 GB** |
| Images | 94 | 22 | 12.91 GB | 5.99 GB (46%) |
| Local volumes | 14 | 10 | 21.45 GB | 7.40 GB (34%) |
| Containers | 24 | 16 | 44 MB | 43 MB |

**≈33 GB is reclaimable, and 19.77 GB of it is build cache with zero active
entries** — residue from the pre-systemd deployment era, when the app was built
and run in Docker.

This matters more than anything the original plan proposed. `listings` alone is
11 GB and grows with every crawl; the rent audit partitions add ~1 GB a month.
At 86% the box is one large migration, one `REINDEX`, or one runaway log away
from a full disk, and a full disk on this host takes down Postgres, both apps,
and the crawler simultaneously.

## Recommendation

1. **Reclaim the build cache** (`docker builder prune`) — 19.77 GB, zero active
   entries, regenerable by definition. Lowest-risk item on the box.
2. **Then unused images** — 5.99 GB; verify nothing the monitoring stack needs
   is removed.
3. **Volumes last and individually.** 7.4 GB is unused, but volumes from the
   Docker era may hold the only copy of something. Inspect each before removal;
   this is the one step that can destroy data.
4. **Add a disk-headroom probe.** Nothing alerted at 86%. `oper-healthcheck`
   watches host disk, but evidently not at a threshold that fired — check its
   floor and raise it.

The durability half of the original plan (single-CDN dependency) survives
unchanged and is still worth doing; it is unaffected by any of the above.
