# GitHub Pages Receipt

Approach: publish the self-contained onboarding page from `site/` with the official GitHub Pages Actions flow.

Workflow: `.github/workflows/pages.yml`

The workflow runs on pushes to `main`, uploads `site/` as the Pages artifact, and deploys it with `actions/deploy-pages`. Because `site/index.html` is at the artifact root, it renders at the Pages site root.

Human step to enable Pages:

1. Open `TylerJNewman/kb` on GitHub.
2. Go to Settings -> Pages.
3. Set Source to `GitHub Actions`.

Expected public URL: `https://tylerjnewman.github.io/kb/`

Note: enabling GitHub Pages makes this onboarding page public.
