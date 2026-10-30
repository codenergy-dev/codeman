---
title: Specifying a command
url: https://docs.salad.com/container-engine/how-to-guides/specifying-a-command
created_at: 2026-10-30T12:09:07-03:00
updated_at: 2026-10-30T12:09:07-03:00
tool: docs/web/tools/salad.md
license: CC-BY-4.0
---

# Specifying a command

*Last Updated: April 10, 2025*

> 🚧 Caution
>
> Specifying a command overrides the CMD and ENTRYPOINT from your dockerfile. This should only be used if you want to
> override what is already in your dockerfile.
>
> This is not synonymous with `docker run`.

Providing the “command” field when creating or updating a container group overrides the ENTRYPOINT and CMD of a
container image, similar to the CLI `docker run --entrypoint` flag.

The first item in command is executed as the entrypoint, and subsequent items are provided as arguments.

Note that if a command is specified, any ENTRYPOINT and CMD set in the dockerfile are overridden. If needed, `command`
can be used to add additional arguments to a container, by including the existing CMD or ENTRYPOINT of the image.

As an example, running `docker run --entrypoint /bin/test my-container:latest arg1 arg2 arg3` would correspond to the
SaladCloud command of

```json theme={null}
["/bin/test", "arg1", "arg2", "arg3"]
```

**Note:** in the portal, you should not include include quotes around arguments. To reproduce the docker command line
`docker run --entrypoint /bin/bash my-docker/my-container:latest -c "python server.py"`, you would enter `/bin/bash` as
the command, `-c` as a first argument, and `python server.py` as a second argument, without quotes.


This documentation is built and hosted on [Mintlify](https://mintlify.com), a developer documentation platform.
