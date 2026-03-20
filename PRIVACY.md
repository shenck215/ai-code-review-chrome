# AI Git Reviewer Privacy Policy

Last updated: 2026-03-20

## Summary

AI Git Reviewer is a Chrome extension that helps users review GitHub and GitLab code changes with third-party AI providers selected by the user.

The extension does not operate its own backend service. All data transmission happens directly from the user's browser to:

- GitHub or GitLab APIs configured by the user
- AI provider APIs selected by the user, including OpenAI, Anthropic, or Google Gemini

## Data We Process

The extension may process the following data when the user runs a review:

- Repository identifier and commit hashes entered by the user
- Diff content fetched from GitHub or GitLab
- API credentials entered by the user
- The current repository page URL, only to auto-detect the repository path in the active tab

## How Data Is Used

The extension uses this data only to:

- Fetch code diffs from the selected Git platform
- Send the diff to the selected AI provider to generate a review
- Display the generated review in the side panel

## Storage

- Non-sensitive preferences such as default platform, default project, model selection, and disclosure consent are stored in `chrome.storage.local`
- Sensitive credentials such as GitHub, GitLab, OpenAI, Anthropic, and Gemini API keys are stored only for the current browser session in `chrome.storage.session`

Sensitive credentials are not sent to any server controlled by the extension developer.

## Data Sharing

When the user starts a review, relevant diff content is transmitted to:

- The selected Git platform API
- The selected AI provider API

Users should not submit code or data they are not authorized to share with those providers.

## No Developer Backend

This extension does not provide a developer-hosted backend for storing repository content, prompts, or review results.

## User Control

Users can:

- Clear all stored extension data from the options page
- Choose which AI provider to use
- Decide whether to configure GitHub, GitLab, or both

## Contact

Before publishing, replace this section with your real support contact:

- Email: `your-support-email@example.com`
- Website: `https://your-domain.example.com`
