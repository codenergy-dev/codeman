---
title: Attaching files
url: https://docs.github.com/en/get-started/writing-on-github/working-with-advanced-formatting/attaching-files
created_at: 2026-11-26T13:15:10-03:00
updated_at: 2026-11-26T13:15:10-03:00
tool: docs/web/tools/github.md
license: CC-BY-4.0
---

# Attaching files

You can convey information by attaching a variety of file types to your issues and pull requests.

> [!NOTE]
> For public repositories, uploaded files can be accessed without authentication. In the case of private and internal repositories, only people with access to the repository can view the uploaded files.

You can attach files to issues, pull requests, and comments in your browser. You can also attach local images and videos from the command line with GitHub CLI. For more information, see [Attaching files with GitHub CLI](/en/github-cli/github-cli/attaching-files-with-github-cli).

To attach a file in your browser, drag and drop it into the comment box.
Alternatively, you can click <svg version="1.1" width="16" height="16" viewBox="0 0 16 16" class="octicon octicon-paperclip" aria-label="Attach files" role="img"><path d="M12.212 3.02a1.753 1.753 0 0 0-2.478.003l-5.83 5.83a3.007 3.007 0 0 0-.88 2.127c0 .795.315 1.551.88 2.116.567.567 1.333.89 2.126.89.79 0 1.548-.321 2.116-.89l5.48-5.48a.75.75 0 0 1 1.061 1.06l-5.48 5.48a4.492 4.492 0 0 1-3.177 1.33c-1.2 0-2.345-.487-3.187-1.33a4.483 4.483 0 0 1-1.32-3.177c0-1.195.475-2.341 1.32-3.186l5.83-5.83a3.25 3.25 0 0 1 5.553 2.297c0 .863-.343 1.691-.953 2.301L7.439 12.39c-.375.377-.884.59-1.416.593a1.998 1.998 0 0 1-1.412-.593 1.992 1.992 0 0 1 0-2.828l5.48-5.48a.751.751 0 0 1 1.042.018.751.751 0 0 1 .018 1.042l-5.48 5.48a.492.492 0 0 0 0 .707.499.499 0 0 0 .352.154.51.51 0 0 0 .356-.154l5.833-5.827a1.755 1.755 0 0 0 0-2.481Z"></path></svg> below the issue comment box to browse, select, and add a file from your computer.

![Screenshot of the issue comment box. The "Attach files" icon is outlined in orange.](/assets/images/help/issues/attach-file.png)

For a pull request, you can also click <svg version="1.1" width="16" height="16" viewBox="0 0 16 16" class="octicon octicon-paperclip" aria-label="Attach files" role="img"><path d="M12.212 3.02a1.753 1.753 0 0 0-2.478.003l-5.83 5.83a3.007 3.007 0 0 0-.88 2.127c0 .795.315 1.551.88 2.116.567.567 1.333.89 2.126.89.79 0 1.548-.321 2.116-.89l5.48-5.48a.75.75 0 0 1 1.061 1.06l-5.48 5.48a4.492 4.492 0 0 1-3.177 1.33c-1.2 0-2.345-.487-3.187-1.33a4.483 4.483 0 0 1-1.32-3.177c0-1.195.475-2.341 1.32-3.186l5.83-5.83a3.25 3.25 0 0 1 5.553 2.297c0 .863-.343 1.691-.953 2.301L7.439 12.39c-.375.377-.884.59-1.416.593a1.998 1.998 0 0 1-1.412-.593 1.992 1.992 0 0 1 0-2.828l5.48-5.48a.751.751 0 0 1 1.042.018.751.751 0 0 1 .018 1.042l-5.48 5.48a.492.492 0 0 0 0 .707.499.499 0 0 0 .352.154.51.51 0 0 0 .356-.154l5.833-5.827a1.755 1.755 0 0 0 0-2.481Z"></path></svg> in the formatting bar above the pull request comment box.

![Screenshot of the pull request comment box. The "Attach files" icon is outlined in orange.](/assets/images/help/pull_requests/attach-file.png)

When you attach a file, it is uploaded immediately to GitHub and the text field is updated to show the anonymized URL for the file. For more information on anonymized URLs see [About anonymized URLs](/en/authentication/keeping-your-account-and-data-secure/about-anonymized-urls).

> [!NOTE]
> In many browsers, you can copy-and-paste images directly into the box.

The maximum file size is:

* 10MB for images and gifs
* 10MB for videos uploaded to a repository owned by a user or organization on a free GitHub plan
* 100MB for videos uploaded to a repository owned by a user or organization on a paid GitHub plan
* 25MB for all other files

> [!NOTE]
> To upload videos greater than 10MB to a repository owned by a user or organization on a paid GitHub plan, you must either be an organization member or outside collaborator, or be on a paid plan.

## Supported file types

The following image and media file types are supported in all contexts.

### Image and media files

* PNG (`.png`)
* GIF (`.gif`)
* JPEG (`.jpg`, `.jpeg`)
* SVG (`.svg`)
* Video (`.mp4`, `.mov`, `.webm`)

  > [!NOTE]
  > Video codec compatibility is browser specific, and it's possible that a video you upload to one browser is not viewable on another browser. At the moment we recommend using H.264 for greatest compatibility.

## Additional file types

The following file types are supported for uploads in issue comments, pull request comments, and discussion comments within repositories. This list of file types is also supported in organization discussions.

### Documents

* PDFs (`.pdf`)
* Microsoft Office documents (`.docx`, `.pptx`, `.xlsx`, `.xls`, `.xlsm`)
* OpenDocument formats (`.odt`, `.fodt`, `.ods`, `.fods`, `.odp`, `.fodp`, `.odg`, `.fodg`, `.odf`)
* Rich text and word processing files (`.rtf`, `.doc`)

### Text and data files

* Plain text and markup (`.txt`, `.md`, `.copilotmd`)
* Data and tabular files (`.csv`, `.tsv`, `.log`, `.json`, `.jsonc`)

### Development and code files

* C files (`.c`)
* C# files (`.cs`)
* C++ files (`.cpp`)
* CSS files (`.css`)
* Diagrams (`.drawio`)
* Dump files (`.dmp`)
* HTML files (`.html`, `.htm`)
* Java files (`.java`)
* JavaScript files (`.js`)
* Jupyter notebooks (`.ipynb`)
* Patch files (`.patch`)
* PHP files (`.php`)
* Profiling files (`.cpuprofile`)
* Program database files (`.pdb`)
* Python files (`.py`)
* Shell scripts (`.sh`)
* SQL files (`.sql`)
* TypeScript files (`.ts`, `.tsx`)
* XML files (`.xml`)
* YAML files (`.yaml`, `.yml`)

> [!NOTE]
> If you use Linux and try to upload a `.patch` file, you will receive an error message. This is a known issue.

### Archive and compressed files

* Archives and packages (`.zip`, `.gz`, `.tgz`)

### Communication and logs

* Text and email files (`.debug`, `.msg`, `.eml`)

### Images

* Bitmap and TIFF images (`.bmp`, `.tif`, `.tiff`)

### Audio

* Audio files (`.mp3`, `.wav`)