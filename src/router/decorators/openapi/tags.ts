import { CombinedDecorator, Constructor } from "../../../common";
import { AomHttp, TagsRules } from "../../common";

export function UseTag(constructor: Constructor) {
  return AomHttp.combinedDecorator(($) => {
    $.openApi.tags.tag = AomHttp.instance(constructor);
  });
}

export function IgnoreNextTags() {
  return AomHttp.combinedDecorator(($) => {
    $.openApi.tags.rule = TagsRules.IGNORE;
  });
}

export function MergeNextTags() {
  return AomHttp.combinedDecorator(($) => {
    $.openApi.tags.rule = TagsRules.MERGE;
  });
}

export function ReplaceNextTags() {
  return AomHttp.combinedDecorator(($) => {
    $.openApi.tags.rule = TagsRules.REPLACE;
  });
}
