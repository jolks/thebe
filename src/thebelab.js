import * as $ from "jQuery";

import * as CodeMirror from "codemirror";
import { Kernel } from "@jupyterlab/services";
import { ServerConnection } from "@jupyterlab/services";

import { PageConfig } from "@jupyterlab/coreutils";
import { OutputArea, OutputAreaModel } from "@jupyterlab/outputarea";
import { RenderMime, defaultRendererFactories } from "@jupyterlab/rendermime";

import "@jupyterlab/theme-light-extension/style/variables.css";
import "./index.css";

export function renderCell(element) {
  // render a single cell
  // element should be a `<pre>` tag with some code in it
  let $cell = $("<div class='thebelab-cell'/>");
  let $element = $(element);
  let source = $element.text();

  let renderMime = new RenderMime({
    initialFactories: defaultRendererFactories,
  });
  let model = new OutputAreaModel();

  let outputArea = new OutputArea({
    model: model,
    rendermime: renderMime,
  });

  $element.replaceWith($cell);

  let $cm_element = $("<div class='thebelab-input'>");
  $cell.append($cm_element);
  $cell.append(outputArea.node);

  let cm = new CodeMirror($cm_element[0], {
    value: source,
    mode: $element.data("language") || "python3",
    extraKeys: {
      "Shift-Enter": () => {
        let kernel = $cell.data("kernel");
        if (!kernel) {
          console.error("No kernel connected");
        } else {
          outputArea.future = kernel.requestExecute({ code: cm.getValue() });
        }
        return false;
      },
    },
  });
  $cell.data("codemirror", cm);

  return $cell;
}

export function renderAllCells(
  {
    selector = "[data-executable]",
  } = {}
) {
  // render all elements matching `selector` as cells.
  // by default, this is all cells with `data-executable`
  return $(selector).map((i, cell) => renderCell(cell));
}

export function requestKernel(kernelOptions) {
  // request a new Kernel
  kernelOptions = kernelOptions || getKernelOptions();
  if (kernelOptions.serverSettings) {
    kernelOptions.serverSettings = ServerConnection.makeSettings(
      kernelOptions.serverSettings
    );
  }
  return Kernel.startNew(kernelOptions);
}

export function hookupKernel(kernel, cells) {
  // hooks up cells to the kernel
  cells.map((i, cell) => {
    $(cell).data("kernel", kernel);
  });
}

export function requestBinderKernel(
  {
    binderOptions,
    kernelOptions,
  }
) {
  // request a Kernel from Binder
  // this strings together requestBinder and requestKernel.
  // returns a Promise for a running Kernel.
  return requestBinder(binderOptions).then(serverSettings => {
    kernelOptions.serverSettings = serverSettings;
    return requestKernel(kernelOptions);
  });
}

export function getOption(key, options, defaultValue) {
  let value = undefined;
  if (options) {
    value = options[key];
    if (value !== undefined) return value;
  }
  value = PageConfig.getOption(key);
  if (value !== "") return value;
  return defaultValue;
}

function getBinderOptions(options) {
  return {
    repo: getOption("binderRepo", options),
    ref: getOption("binderRef", options, "master"),
    binderUrl: getOption("binderUrl", options, "https://beta.mybinder.org"),
  };
}
function getKernelOptions(options) {
  let kernelOptions = (options || {}).kernelOptions || {};
  if (!kernelOptions.name) {
    kernelOptions.name = getOption("thebeKernelName", options);
  }
  return kernelOptions;
}

export function bootstrap(options) {
  // bootstrap thebe on the page

  options = options || {};
  // bootstrap thebelab on the page
  let cells = renderAllCells(getOption("thebeCellSelector", options));
  let kernelPromise;

  let binderRepo = getOption("binderRepo", options);
  if (binderRepo) {
    kernelPromise = requestBinderKernel({
      binderOptions: getBinderOptions(options),
      kernelOptions: getKernelOptions(options),
    });
  } else {
    kernelPromise = requestKernel(getKernelOptions(options));
  }
  kernelPromise.then(kernel => {
    // debug
    window.thebeKernel = kernel;
    hookupKernel(kernel, cells);
  });
}

export function requestBinder(
  {
    repo,
    ref = "master",
    binderUrl = null,
  } = {}
) {
  // request a server from Binder
  // returns a Promise that will resolve with a serverSettings dict

  // populate fro defaults
  let defaults = getBinderOptions();
  repo = repo || defaults.repo;
  console.log("binder url", binderUrl, defaults);
  binderUrl = binderUrl || defaults.binderUrl;
  ref = ref || defaults.ref;

  // trim github.com from repo
  repo = repo.replace(/^(https?:\/\/)?github.com\//, "");
  // trim trailing or leading '/' on repo
  repo = repo.replace(/(^\/)|(\/?$)/g, "");
  // trailing / on binderUrl
  binderUrl = binderUrl.replace(/(\/?$)/g, "");

  let url = binderUrl + "/build/gh/" + repo + "/" + ref;
  console.log("Binder build URL", url);
  return new Promise((resolve, reject) => {
    let es = new EventSource(url);
    es.onerror = err => {
      console.error("Lost connection to " + url, err);
      es.close();
      reject(new Error(err));
    };
    es.onmessage = evt => {
      let msg = JSON.parse(evt.data);
      switch (msg.phase) {
        case "failed":
          console.error("Failed to build", url, msg);
          es.close();
          reject(new Error(msg));
          break;
        case "ready":
          es.close();
          resolve(
            ServerConnection.makeSettings({
              baseUrl: msg.url,
              token: msg.token,
            })
          );
          break;
        default:
        // console.log(msg);
      }
    };
  });
}
