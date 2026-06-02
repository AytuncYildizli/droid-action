# GitLab examples

Drop-in `.gitlab-ci.yml` samples for consuming the droid-action GitLab
CI/CD Component.

| File                     | When to use                                                                                                    |
| ------------------------ | -------------------------------------------------------------------------------------------------------------- |
| `.gitlab-ci.minimal.yml` | Shortest possible — `include:` the review template, accept every default. Good starting point.                 |
| `.gitlab-ci.example.yml` | Annotated. Every input spelled out with comments explaining what it does and what the safe defaults look like. |

Both samples wire the same two required CI/CD variables:

- `FACTORY_API_KEY` — get one at <https://app.factory.ai/settings/api-keys>.
- `GITLAB_TOKEN` — a personal access token with `api` scope, owned by
  whichever GitLab user/account should be the poster of review comments.
  To change the poster later, replace this variable's value.

Set both as **masked** CI/CD variables at the level you want the review
to apply (project, subgroup, or top-level group).

For the full input reference (model overrides, security review,
suggestion blocks, custom stage, etc.) see
[`../templates/review.yml`](../templates/review.yml) or the docs at
[`docs/gitlab-setup.md`](../../docs/gitlab-setup.md).
