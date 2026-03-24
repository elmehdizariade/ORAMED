# ORAMED - Gestion Stock Dépôt

This is a static HTML single-page application (SPA) meant to handle the storage, movement, and direction analytics for the ORAMED depository.

## Structure
This project is built purely with static web technologies (HTML, CSS, JS) and all code is maintained inside a single `index.html` file. No complicated build steps, Node.js scripts, or frameworks are required. 

## Running the Project Locally
To run the app locally, simply open the `index.html` file in any modern web browser (Google Chrome, Firefox, Safari, Edge).

## Roles and Access
The app contains a dynamically switched feature set tailored for two user roles: **Direction** and **Opérateur**.
The app assigns roles based on query parameters inside the URL and remembers the assigned role via LocalStorage. 

To assign or switch a role:
1. **Direction Mode**: Add `?role=direction` to the URL. 
   *(Example: `file:///C:/path/to/project/index.html?role=direction`)*
2. **Opérateur Mode**: Add `?role=operateur` to the URL. 
   *(Example: `http://localhost:3000/index.html?role=operateur`)*

If no role parameter is given, the app checks `localStorage` to see what previous role was assigned. If no prior role exists, it safely defaults to `direction`.

## Deploying on Vercel
Since this project is a pure static HTML website, hosting on Vercel is extremely straightforward:
1. Push this repository to GitHub.
2. Go to [Vercel](https://vercel.com/) and create a new project.
3. Import the GitHub repository.
4. Leave the "Framework Preset" as `Other` or `None`.
5. Vercel will automatically recognize the static directory and deploy `index.html` as the root document of your website. There is no build command and no output directory to configure.
6. Click **Deploy**. Your site will be live instantly.

### Do I need a `vercel.json` file?
**No.** Vercel requires absolutely no configuration to serve an `index.html` file out of the root directory. Vercel intrinsically knows that a folder without a `package.json` build step and containing an `index.html` is a static site. Therefore, adding a `vercel.json` file is unnecessary and has been purposefully omitted to keep the project clean.
