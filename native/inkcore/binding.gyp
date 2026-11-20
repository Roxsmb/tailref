{
  "targets": [
    {
      "target_name": "inkcore",
      "sources": [ "src/inkcore_napi.cpp" ],
      "msvs_settings": {
        "VCCLCompilerTool": {
          "Optimization": 3,
          "EnableEnhancedInstructionSet": "2",
          "ExceptionHandling": "0",
          "RuntimeLibrary": "0"
        },
        "VCLibrarianTool": {},
        "VCLinkerTool": {}
      },
      "conditions": [
        ["OS=='win'", {
          "msbuild_toolset": "v143"
        }]
      ]
    }
  ]
}
