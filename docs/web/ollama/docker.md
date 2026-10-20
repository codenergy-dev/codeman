---
title: Docker
url: https://docs.ollama.com/docker
created_at: 2026-10-20T12:40:33-03:00
updated_at: 2026-10-20T12:40:33-03:00
tool: docs/web/tools/ollama.md
license: MIT
---

> ## Documentation Index
> Fetch the complete documentation index at: https://docs.ollama.com/llms.txt
> Use this file to discover all available pages before exploring further.

# Docker

## CPU only

```shell theme={"system"}
docker run -d -v ollama:/root/.ollama -p 11434:11434 --name ollama ollama/ollama
```

## Nvidia GPU

Install the [NVIDIA Container Toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/install-guide.html#installation).

### Install with Apt

1. Configure the repository

   ```shell theme={"system"}
   curl -fsSL https://nvidia.github.io/libnvidia-container/gpgkey \
       | sudo gpg --dearmor -o /usr/share/keyrings/nvidia-container-toolkit-keyring.gpg
   curl -fsSL https://nvidia.github.io/libnvidia-container/stable/deb/nvidia-container-toolkit.list \
       | sed 's#deb https://#deb [signed-by=/usr/share/keyrings/nvidia-container-toolkit-keyring.gpg] https://#g' \
       | sudo tee /etc/apt/sources.list.d/nvidia-container-toolkit.list
   sudo apt-get update
   ```

2. Install the NVIDIA Container Toolkit packages

   ```shell theme={"system"}
   sudo apt-get install -y nvidia-container-toolkit
   ```

### Install with Yum or Dnf

1. Configure the repository

   ```shell theme={"system"}
   curl -fsSL https://nvidia.github.io/libnvidia-container/stable/rpm/nvidia-container-toolkit.repo \
       | sudo tee /etc/yum.repos.d/nvidia-container-toolkit.repo
   ```

2. Install the NVIDIA Container Toolkit packages

   ```shell theme={"system"}
   sudo yum install -y nvidia-container-toolkit
   ```

### Configure Docker to use Nvidia driver

```shell theme={"system"}
sudo nvidia-ctk runtime configure --runtime=docker
sudo systemctl restart docker
```

### Start the container

```shell theme={"system"}
docker run -d --gpus=all -v ollama:/root/.ollama -p 11434:11434 --name ollama ollama/ollama
```

<Note>
  If you're running on an NVIDIA JetPack system, Ollama can't automatically discover the correct JetPack version.
  Pass the environment variable `JETSON_JETPACK=5` or `JETSON_JETPACK=6` to the container to select version 5 or 6.
</Note>

## AMD GPU

To run Ollama using Docker with AMD GPUs, use the `rocm` tag and the following command:

```shell theme={"system"}
docker run -d --device /dev/kfd --device /dev/dri -v ollama:/root/.ollama -p 11434:11434 --name ollama ollama/ollama:rocm
```

## Vulkan Support

Vulkan is bundled into the `ollama/ollama` image and is enabled by default when
the container can access the GPU devices.

```shell theme={"system"}
docker run -d --device /dev/kfd --device /dev/dri -v ollama:/root/.ollama -p 11434:11434 --name ollama ollama/ollama
```

Use `OLLAMA_VULKAN=0` to disable Vulkan, or `GGML_VK_VISIBLE_DEVICES=<ids>` to
select specific Vulkan devices.

## Run model locally

Now you can run a model:

```shell theme={"system"}
docker exec -it ollama ollama run llama3.2
```

## Try different models

More models can be found on the [Ollama library](https://ollama.com/library).
