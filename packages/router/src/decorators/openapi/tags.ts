import { ClassType } from "@aom-js/core";
import { AomApi, TagsRules } from "../../common";

export function UseTag(constructor: ClassType) {
  return AomApi.combinedDecorator(($) => {
    $.openApi.tag.$ = AomApi.instance(constructor);
  });
}

export function IgnoreNextTags() {
  return AomApi.combinedDecorator(($) => {
    $.openApi.tag.rule = TagsRules.IGNORE;
  });
}

export function MergeNextTags() {
  return AomApi.combinedDecorator(($) => {
    $.openApi.tag.rule = TagsRules.MERGE;
  });
}

export function ReplaceNextTags() {
  return AomApi.combinedDecorator(($) => {
    $.openApi.tag.rule = TagsRules.REPLACE;
  });
}
